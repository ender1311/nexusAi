"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Users, Zap } from "lucide-react";
import { Header } from "@/components/layout/header";
import { AgentToggleCard } from "@/components/control-tower/agent-toggle-card";
import { OptimizationObjective } from "@/components/control-tower/optimization-objective";
import { ScanningAnimation } from "@/components/control-tower/scanning-animation";
import { PredictionResults } from "@/components/control-tower/prediction-results";
import { UserInspector } from "@/components/control-tower/user-inspector";
import { CronRuns } from "@/components/control-tower/cron-runs";
import {
  controlAgents,
  scanningPhases,
  computePredictions,
  buildDefaultConfig,
  type PredictionResult,
  type OptimizationConfig,
} from "@/lib/mock/control-tower";
import type { StatsData } from "@/app/api/stats/route";
import { useDataMode } from "@/components/layout/data-mode-provider";

type PageState = "configure" | "scanning" | "results";

function buildDefaultEnabled(): Record<string, boolean> {
  return Object.fromEntries(controlAgents.map((a) => [a.id, a.defaultEnabled]));
}

export default function ControlTowerPage() {
  const [pageState, setPageState] = useState<PageState>("configure");
  const [enabledAgents, setEnabledAgents] = useState<Record<string, boolean>>(buildDefaultEnabled);
  const [config, setConfig] = useState<OptimizationConfig>(buildDefaultConfig);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanPhase, setScanPhase] = useState("");
  const [predictions, setPredictions] = useState<PredictionResult[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const { isDemo } = useDataMode();

  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (isDemo) { setStats(null); return; }
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d: StatsData) => setStats(d))
      .catch(() => {/* non-critical */});
  }, [isDemo]);

  // Clear all pending timeouts
  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  useEffect(() => {
    if (pageState !== "scanning") return;

    setScanProgress(0);
    clearTimeouts();

    // Substitute real user count into the scanning phase label if available
    const phasesWithCount = scanningPhases.map((p, i) =>
      i === 1 && stats
        ? { ...p, label: `Analyzing ${stats.trackedUsers.toLocaleString()} user behavioral vectors...` }
        : p
    );
    const totalDuration = phasesWithCount.reduce((s, p) => s + p.durationMs, 0);
    let elapsed = 0;

    phasesWithCount.forEach((phase, i) => {
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

      if (i === phasesWithCount.length - 1) {
        const t3 = setTimeout(() => {
          setScanProgress(100);
          const enabledIds = Object.entries(enabledAgents)
            .filter(([, on]) => on)
            .map(([id]) => id);
          setPredictions(computePredictions(enabledIds, config));
          setPageState("results");
        }, elapsed);
        timeoutsRef.current.push(t3);
      }
    });

    return clearTimeouts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, stats]);

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
      <Header title="Control Tower" description="AI-Powered Optimization Command Center">
        {isResults && (
          <button
            onClick={handleReconfigure}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reconfigure
          </button>
        )}
      </Header>

      {/* Live database stats bar */}
      <div className="border-b bg-muted/30 px-6 py-2.5 flex items-center gap-6 text-sm shrink-0">
        {isDemo && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Demo
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">
            {stats ? stats.trackedUsers.toLocaleString() : "—"}
          </span>
          <span>users tracked</span>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {stats ? stats.personas : "—"}
          </span>
          {" "}active personas
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {stats ? stats.totalDecisions.toLocaleString() : "—"}
          </span>
          {" "}decisions made
        </span>
        {stats && stats.totalDecisions > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {((stats.totalConversions / stats.totalDecisions) * 100).toFixed(1)}%
              </span>
              {" "}conversion rate
            </span>
          </>
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
            <OptimizationObjective
              config={config}
              onChange={setConfig}
              disabled={isScanning}
            />

            {!isResults && (
              <button
                type="button"
                aria-label="Activate Nexus AI optimization"
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

        {/* User inspector — always visible, real DB data */}
        <div className="border-t pt-6">
          <UserInspector />
        </div>

        {/* Cron run history */}
        <div className="border-t pt-6">
          <CronRuns />
        </div>
      </div>
    </div>
  );
}
