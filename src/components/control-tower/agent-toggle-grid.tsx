"use client";

import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { AgentToggleCard } from "@/components/control-tower/agent-toggle-card";
import { controlAgents, type ControlAgent } from "@/lib/control-tower/projection";

/** Minimal serializable shape of an Agent row passed from the Server Component. */
export type SerializedAgent = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  funnelStage: string;
  color: string;
  sendingPaused: boolean;
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
    defaultEnabled: a.status === "active" && !a.sendingPaused,
    impactWeights: { responseRate: 0.5, revenue: 0.3, churnReduction: 0.3, funnelProgression: 0.4 },
  }));
}

interface AgentToggleGridProps {
  agents: SerializedAgent[];
}

/**
 * Interactive AI-agent toggle grid for the control tower. Owns the optimistic
 * enable/disable state, the deactivation confirmation dialog, and the success
 * toast. Rendered inside its own Suspense boundary by the control-tower page.
 */
export function AgentToggleGrid({ agents }: AgentToggleGridProps) {
  // Use real DB agents if available, fall back to sample agents for an empty instance.
  const initialPool = agents.length > 0 ? mapDbAgents(agents) : controlAgents;

  const [agentPool] = useState<ControlAgent[]>(initialPool);
  const [enabledAgents, setEnabledAgents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialPool.map((a) => [a.id, a.defaultEnabled]))
  );
  const [notification, setNotification] = useState<string | null>(null);

  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = (msg: string) => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification(msg);
    notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
  };

  const updateSending = async (agentId: string, sendingPaused: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendingPaused }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Pause is reversible and non-destructive (cohort + learning are preserved), so
  // turning an agent off pauses immediately with no confirmation dialog.
  const handleToggle = (agentId: string, on: boolean) => {
    setEnabledAgents((prev) => ({ ...prev, [agentId]: on }));
    const name = agentPool.find((a) => a.id === agentId)?.name ?? "Agent";
    void updateSending(agentId, !on).then((ok) => {
      if (!ok) {
        setEnabledAgents((prev) => ({ ...prev, [agentId]: !on }));
        showNotification(`Failed to ${on ? "resume" : "pause"} agent — please try again`);
        return;
      }
      showNotification(on ? `${name} resumed` : `${name} paused`);
    });
  };

  const enabledCount = Object.values(enabledAgents).filter(Boolean).length;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          AI Agents
          <InfoTip title="AI Agents">
            <p>Each agent targets a specific user segment (funnel stage) and autonomously learns which message variant produces the best outcomes using a bandit algorithm.</p>
            <p className="mt-1"><strong>Active agents</strong> run on every cron cycle — the bandit selects and sends the best variant for each eligible user, then updates its model when rewards arrive.</p>
            <p className="mt-1">Toggling an agent <strong>off</strong> pauses its sends immediately and <strong>freezes</strong> its cohort, user assignments, and learning. Turn it back on to resume exactly where it left off.</p>
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

      {/* Success notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg animate-in slide-in-from-bottom-2 fade-in-0">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <span>{notification}</span>
        </div>
      )}
    </>
  );
}
