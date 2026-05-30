"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Users } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { FunnelStageBreakdown } from "@/components/charts/funnel-stage-breakdown";
import { formatNumber } from "@/lib/utils";
import { Header } from "@/components/layout/header";
import { AgentToggleCard } from "@/components/control-tower/agent-toggle-card";
import { UserInspector } from "@/components/control-tower/user-inspector";
import { CronRuns } from "@/components/control-tower/cron-runs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { controlAgents, type ControlAgent } from "@/lib/mock/control-tower";
import type { StatsData } from "@/app/api/stats/route";

/** Minimal serializable shape of an Agent row passed from the Server Component. */
export type SerializedAgent = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  funnelStage: string;
  color: string;
};

const STAGE_COLORS: Record<string, string> = {
  new: "#1ab7c9", lapsed: "#ff801a", connected: "#1ac980",
  activated: "#ff3d4d", engaged: "#801aff", inspired: "#ff3d4d",
};

function mapDbAgents(agents: SerializedAgent[]): ControlAgent[] {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    icon: "Bot",
    color: a.color || STAGE_COLORS[a.funnelStage] || "#6366f1",
    defaultEnabled: a.status === "active",
    impactWeights: { responseRate: 0.5, revenue: 0.3, churnReduction: 0.3, funnelProgression: 0.4 },
  }));
}

interface ControlTowerUIProps {
  agents: SerializedAgent[];
  stats: StatsData | null;
  brazeSends: number | null;
  funnelBreakdown: Array<{ stage: string; count: number }>;
}

export function ControlTowerUI({ agents, stats, brazeSends, funnelBreakdown }: ControlTowerUIProps) {
  // Use real DB agents if available, fall back to sample agents for an empty instance.
  const initialPool = agents.length > 0 ? mapDbAgents(agents) : controlAgents;

  const [agentPool] = useState<ControlAgent[]>(initialPool);
  const [enabledAgents, setEnabledAgents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialPool.map((a) => [a.id, a.defaultEnabled]))
  );
  const [pendingOff, setPendingOff] = useState<string | null>(null); // agent id awaiting deactivation confirm
  const [notification, setNotification] = useState<string | null>(null);

  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = (msg: string) => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification(msg);
    notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
  };

  const updateAgentStatus = async (agentId: string, status: "active" | "draft"): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const handleToggle = (agentId: string, on: boolean) => {
    if (!on) {
      setPendingOff(agentId); // show confirmation dialog
      return;
    }
    // Turning on: optimistic update; rollback on failure
    setEnabledAgents((prev) => ({ ...prev, [agentId]: true }));
    void updateAgentStatus(agentId, "active").then((ok) => {
      if (!ok) {
        setEnabledAgents((prev) => ({ ...prev, [agentId]: false }));
        showNotification("Failed to activate agent — please try again");
      }
    });
  };

  const confirmTurnOff = async () => {
    if (!pendingOff) return;
    const agentId = pendingOff;
    setPendingOff(null);
    setEnabledAgents((prev) => ({ ...prev, [agentId]: false }));
    const ok = await updateAgentStatus(agentId, "draft");
    if (!ok) {
      setEnabledAgents((prev) => ({ ...prev, [agentId]: true }));
      showNotification("Failed to deactivate agent — please try again");
      return;
    }
    const name = agentPool.find((a) => a.id === agentId)?.name ?? "Agent";
    showNotification(`${name} has been turned off`);
  };

  const enabledCount = Object.values(enabledAgents).filter(Boolean).length;

  return (
    <div className="flex flex-col min-h-0">
      <Header title="Control Tower" description="AI-Powered Optimization Command Center" />

      {/* Live database stats bar */}
      <div className="border-b bg-muted/30 px-4 sm:px-6 py-2 sm:py-2.5 flex items-center gap-4 sm:gap-6 text-sm shrink-0 overflow-x-auto">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">
            {stats ? formatNumber(stats.trackedUsers) : "—"}
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
            {brazeSends != null ? formatNumber(brazeSends) : stats ? formatNumber(stats.totalDecisions) : "—"}
          </span>
          {" "}messages sent
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
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Agent cards — span 2 cols */}
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                AI Agents
                <InfoTip title="AI Agents">
                  <p>Each agent targets a specific user segment (funnel stage) and autonomously learns which message variant produces the best outcomes using a bandit algorithm.</p>
                  <p className="mt-1"><strong>Active agents</strong> run on every cron cycle — the bandit selects and sends the best variant for each eligible user, then updates its model when rewards arrive.</p>
                  <p className="mt-1">Toggling an agent <strong>off</strong> (draft) stops all future sends immediately without losing any learning history. Turn it back on to resume from where it left off.</p>
                  <p className="mt-1">The algorithm, goals, scheduling rules, and target personas for each agent are configured on the agent&apos;s detail page.</p>
                </InfoTip>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">
                {enabledCount}/{agentPool.length} active
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agentPool.map((agent) => (
                <AgentToggleCard
                  key={agent.id}
                  agent={agent}
                  enabled={enabledAgents[agent.id] ?? false}
                  onToggle={(on) => handleToggle(agent.id, on)}
                />
              ))}
            </div>
          </div>

          {/* Funnel breakdown */}
          <div className="space-y-4">
            {funnelBreakdown.length > 0 && (
              <FunnelStageBreakdown rows={funnelBreakdown} title="Users by Stage" />
            )}
          </div>
        </div>

        {/* User inspector — always visible, real DB data */}
        <div className="border-t pt-6">
          <UserInspector />
        </div>

        {/* Cron run history */}
        <div className="border-t pt-6">
          <CronRuns />
        </div>
      </div>

      {/* Deactivation confirmation dialog */}
      <AlertDialog open={pendingOff !== null} onOpenChange={(open) => { if (!open) setPendingOff(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off {agentPool.find((a) => a.id === pendingOff)?.name ?? "agent"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent will stop sending messages immediately. You can turn it back on at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmTurnOff}>
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg animate-in slide-in-from-bottom-2 fade-in-0">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <span>{notification}</span>
        </div>
      )}
    </div>
  );
}
