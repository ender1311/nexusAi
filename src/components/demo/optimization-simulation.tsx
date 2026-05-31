"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Zap } from "lucide-react";
import { AgentToggleCard } from "@/components/control-tower/agent-toggle-card";
import { OptimizationObjective } from "@/components/control-tower/optimization-objective";
import { ScanningAnimation } from "@/components/control-tower/scanning-animation";
import { PredictionResults } from "@/components/control-tower/prediction-results";
import { InfoTip } from "@/components/ui/info-tip";
import {
  controlAgents,
  scanningPhases,
  computePredictions,
  buildDefaultConfig,
  type PredictionResult,
  type OptimizationConfig,
} from "@/lib/control-tower/projection";

type SimState = "configure" | "scanning" | "results";

/**
 * Illustrative optimization simulation. Uses mock agents and a heuristic
 * projection — it is intentionally NOT wired to live agents or real metrics.
 * Lives on the demo page so the real Control Tower surfaces stay unambiguous.
 */
export function OptimizationSimulation() {
  const [simState, setSimState] = useState<SimState>("configure");
  const [enabledAgents, setEnabledAgents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(controlAgents.map((a) => [a.id, a.defaultEnabled]))
  );
  const [config, setConfig] = useState<OptimizationConfig>(buildDefaultConfig);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanPhase, setScanPhase] = useState("");
  const [predictions, setPredictions] = useState<PredictionResult[]>([]);

  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  useEffect(() => {
    if (simState !== "scanning") return;

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
          setPredictions(computePredictions(enabledIds, config));
          setSimState("results");
        }, elapsed);
        timeoutsRef.current.push(t3);
      }
    });

    return clearTimeouts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simState]);

  const enabledCount = Object.values(enabledAgents).filter(Boolean).length;
  const isScanning = simState === "scanning";
  const isResults = simState === "results";

  const handleReconfigure = () => {
    clearTimeouts();
    setScanProgress(0);
    setScanPhase("");
    setSimState("configure");
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide flex items-center gap-1.5">
            Simulation
            <InfoTip title="Optimization Simulation">
              <p>An <strong>illustrative</strong> what-if projection of how enabling different AI agents and choosing an optimization objective could shift key metrics.</p>
              <p className="mt-1">This is a demonstration only — it uses sample agents and a heuristic model. It does <strong>not</strong> activate live agents or read real performance data.</p>
            </InfoTip>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            Illustrative projection only — not connected to live agents or real metrics.
          </p>
        </div>
        {isResults && (
          <button
            onClick={handleReconfigure}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reconfigure
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Agent toggles — span 2 cols */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sample Agents</h3>
            <span className="text-xs text-muted-foreground font-mono">
              {enabledCount}/{controlAgents.length} enabled
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

        {/* Objective + run */}
        <div className="space-y-4">
          <OptimizationObjective config={config} onChange={setConfig} disabled={isScanning} />

          {!isResults && (
            <button
              type="button"
              aria-label="Run optimization simulation"
              onClick={() => setSimState("scanning")}
              disabled={isScanning || enabledCount === 0}
              className="w-full relative flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-primary to-red-600 shadow-[0_0_20px_rgba(255,61,77,0.4)] hover:shadow-[0_0_30px_rgba(255,61,77,0.6)] hover:scale-[1.01] active:scale-[0.99]"
            >
              <Zap className="h-4 w-4" />
              {isScanning ? "Analyzing..." : "Run Simulation"}
            </button>
          )}
        </div>
      </div>

      {isScanning && <ScanningAnimation phase={scanPhase} progress={scanProgress} />}

      {isResults && <PredictionResults results={predictions} />}
    </section>
  );
}
