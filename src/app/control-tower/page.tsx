"use client";

import { useEffect, useRef, useState } from "react";
import { Radar, RotateCcw, Zap } from "lucide-react";
import { AgentToggleCard } from "@/components/control-tower/agent-toggle-card";
import { OptimizationSliders } from "@/components/control-tower/optimization-sliders";
import { ScanningAnimation } from "@/components/control-tower/scanning-animation";
import { PredictionResults } from "@/components/control-tower/prediction-results";
import {
  controlAgents,
  optimizationParams,
  scanningPhases,
  computePredictions,
  type PredictionResult,
} from "@/lib/mock/control-tower";

type PageState = "configure" | "scanning" | "results";

function buildDefaultWeights(): Record<string, number> {
  return Object.fromEntries(optimizationParams.map((p) => [p.id, 25]));
}

/** Proportionally redistribute remaining budget among other sliders so total stays at 100. */
function redistributeWeights(
  prev: Record<string, number>,
  changedId: string,
  newValue: number
): Record<string, number> {
  const allIds = optimizationParams.map((p) => p.id);
  const otherIds = allIds.filter((id) => id !== changedId);
  const remaining = 100 - newValue;
  const otherTotal = otherIds.reduce((sum, id) => sum + (prev[id] ?? 0), 0);

  let newOtherWeights: Record<string, number>;
  if (otherTotal === 0) {
    // All others are at 0 — distribute evenly
    const each = Math.floor(remaining / otherIds.length);
    newOtherWeights = Object.fromEntries(otherIds.map((id) => [id, each]));
  } else {
    // Scale proportionally
    newOtherWeights = Object.fromEntries(
      otherIds.map((id) => [id, Math.round(((prev[id] ?? 0) / otherTotal) * remaining)])
    );
  }

  // Fix off-by-one rounding errors so sum is exactly 100
  const computedTotal =
    newValue + otherIds.reduce((s, id) => s + (newOtherWeights[id] ?? 0), 0);
  const diff = 100 - computedTotal;
  if (diff !== 0 && otherIds.length > 0) {
    newOtherWeights[otherIds[0]] = (newOtherWeights[otherIds[0]] ?? 0) + diff;
  }

  return { ...newOtherWeights, [changedId]: newValue };
}

function buildDefaultEnabled(): Record<string, boolean> {
  return Object.fromEntries(controlAgents.map((a) => [a.id, a.defaultEnabled]));
}

export default function ControlTowerPage() {
  const [pageState, setPageState] = useState<PageState>("configure");
  const [enabledAgents, setEnabledAgents] = useState<Record<string, boolean>>(buildDefaultEnabled);
  const [sliderWeights, setSliderWeights] = useState<Record<string, number>>(buildDefaultWeights);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanPhase, setScanPhase] = useState("");
  const [predictions, setPredictions] = useState<PredictionResult[]>([]);

  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clear all pending timeouts
  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  useEffect(() => {
    if (pageState !== "scanning") return;

    setScanProgress(0);
    clearTimeouts();

    const totalDuration = scanningPhases.reduce((s, p) => s + p.durationMs, 0);
    let elapsed = 0;

    scanningPhases.forEach((phase, i) => {
      const t1 = setTimeout(() => {
        setScanPhase(phase.label);
        setScanProgress((elapsed / totalDuration) * 100);
      }, elapsed);
      timeoutsRef.current.push(t1);
      elapsed += phase.durationMs;

      // Update progress mid-phase
      const mid = elapsed - phase.durationMs / 2;
      const t2 = setTimeout(() => {
        setScanProgress((mid / totalDuration) * 100);
      }, mid);
      timeoutsRef.current.push(t2);

      if (i === scanningPhases.length - 1) {
        const t3 = setTimeout(() => {
          setScanProgress(100);
          const enabledIds = Object.entries(enabledAgents)
            .filter(([, on]) => on)
            .map(([id]) => id);
          setPredictions(computePredictions(enabledIds, sliderWeights));
          setPageState("results");
        }, elapsed);
        timeoutsRef.current.push(t3);
      }
    });

    return clearTimeouts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState]);

  const handleActivate = () => {
    setPageState("scanning");
  };

  const handleReconfigure = () => {
    clearTimeouts();
    setScanProgress(0);
    setScanPhase("");
    setPageState("configure");
  };

  const enabledCount = Object.values(enabledAgents).filter(Boolean).length;
  const isScanning = pageState === "scanning";
  const isResults = pageState === "results";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Radar className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Control Tower</h1>
            <p className="text-xs text-muted-foreground leading-tight">
              AI-Powered Optimization Command Center
            </p>
          </div>
        </div>
        {isResults && (
          <button
            onClick={handleReconfigure}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reconfigure
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Agent toggles + sliders + activate */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent cards — span 2 cols */}
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">AI Agents</h2>
              <span className="text-xs text-muted-foreground font-mono">
                {enabledCount}/{controlAgents.length} active
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {controlAgents.map((agent) => (
                <AgentToggleCard
                  key={agent.id}
                  agent={agent}
                  enabled={enabledAgents[agent.id] ?? false}
                  onToggle={(on) =>
                    setEnabledAgents((prev) => ({ ...prev, [agent.id]: on }))
                  }
                  disabled={isScanning}
                />
              ))}
            </div>
          </div>

          {/* Sliders + activate button */}
          <div className="space-y-4">
            <OptimizationSliders
              weights={sliderWeights}
              onChange={(id, val) =>
                setSliderWeights((prev) => redistributeWeights(prev, id, val))
              }
              disabled={isScanning}
            />

            {!isResults && (
              <button
                onClick={handleActivate}
                disabled={isScanning || enabledCount === 0}
                className="w-full relative flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-primary to-red-600 shadow-[0_0_20px_rgba(255,61,77,0.4)] hover:shadow-[0_0_30px_rgba(255,61,77,0.6)] hover:scale-[1.01] active:scale-[0.99]"
              >
                <Zap className="h-4 w-4" />
                {isScanning ? "Analyzing..." : "Activate Nexus AI"}
              </button>
            )}
          </div>
        </div>

        {/* Scanning animation */}
        {isScanning && (
          <ScanningAnimation phase={scanPhase} progress={scanProgress} />
        )}

        {/* Results */}
        {isResults && <PredictionResults results={predictions} />}
      </div>
    </div>
  );
}
