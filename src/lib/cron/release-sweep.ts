/**
 * Pure Phase −1 logic: decide which active assignments to release this cron run.
 * No DB — the orchestrator loads active assignments + each user's current stage,
 * and applies the returned release set. cohort_exit is decided here using the
 * precomputed set of stages the owning agent targets.
 */

export type ReleaseAgentInfo = {
  id: string;
  holdMaxDays: number;
  holdMaxSends: number;
  /** Stages this agent targets; empty set = no funnel-stage gate (never cohort_exit). */
  targetStages: Set<string>;
};

export type ActiveAssignment = {
  id: string;
  externalUserId: string;
  agentId: string;
  startedAt: Date;
  sendCount: number;
  currentStage: string | null;
};

export type ReleaseReason = "cohort_exit" | "hold_cap_days" | "hold_cap_sends";

export type ReleaseDecision = {
  id: string;            // assignment id
  externalUserId: string;
  reason: ReleaseReason;
};

export function classifyReleases(
  assignments: ActiveAssignment[],
  agentsById: Map<string, ReleaseAgentInfo>,
  now: Date,
): ReleaseDecision[] {
  const out: ReleaseDecision[] = [];
  for (const a of assignments) {
    const agent = agentsById.get(a.agentId);
    if (!agent) continue; // owning agent missing (deleted/paused) — leave for manual cleanup

    // cohort_exit: agent has an explicit target-stage set and the user's current stage isn't in it.
    if (agent.targetStages.size > 0 && (!a.currentStage || !agent.targetStages.has(a.currentStage))) {
      out.push({ id: a.id, externalUserId: a.externalUserId, reason: "cohort_exit" });
      continue;
    }
    // hold_cap_days
    if (now.getTime() - a.startedAt.getTime() > agent.holdMaxDays * 86_400_000) {
      out.push({ id: a.id, externalUserId: a.externalUserId, reason: "hold_cap_days" });
      continue;
    }
    // hold_cap_sends
    if (a.sendCount >= agent.holdMaxSends) {
      out.push({ id: a.id, externalUserId: a.externalUserId, reason: "hold_cap_sends" });
      continue;
    }
  }
  return out;
}
