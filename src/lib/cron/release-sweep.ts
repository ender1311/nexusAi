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
  enrollmentMode: "fixed" | "continuous";
  /**
   * Only for continuous agents: externalUserIds currently matching the segment.
   * `undefined` = orchestrator didn't compute an audience → segment_exit is skipped entirely.
   * Empty Set = segment matched zero users → every enrolled user is released.
   */
  audience?: Set<string>;
};

export type ActiveAssignment = {
  id: string;
  externalUserId: string;
  agentId: string;
  startedAt: Date;
  sendCount: number;
  currentStage: string | null;
};

export type ReleaseReason = "cohort_exit" | "hold_cap_days" | "hold_cap_sends" | "segment_exit";

export type ReleaseDecision = {
  id: string;            // assignment id
  externalUserId: string;
  reason: ReleaseReason;
};

/**
 * Builds the per-agent record consumed by classifyReleases. cohort_exit only
 * applies to funnel-stage-gated agents — segment-targeted (or unfiltered)
 * agents get an empty targetStages set so stage drift never releases them.
 * Pass `audience` only when the orchestrator computed a complete segment
 * audience for a continuous agent; omitting it disables segment_exit.
 */
export function buildReleaseAgentInfo(
  agent: {
    id: string;
    holdMaxDays: number;
    holdMaxSends: number;
    funnelStage: string | null;
    enrollmentMode: "fixed" | "continuous";
  },
  hasSegmentTargeting: boolean,
  audience?: Set<string>,
): ReleaseAgentInfo {
  return {
    id: agent.id,
    holdMaxDays: agent.holdMaxDays,
    holdMaxSends: agent.holdMaxSends,
    targetStages: !hasSegmentTargeting && agent.funnelStage
      ? new Set([agent.funnelStage])
      : new Set<string>(),
    enrollmentMode: agent.enrollmentMode,
    ...(audience !== undefined ? { audience } : {}),
  };
}

export function classifyReleases(
  assignments: ActiveAssignment[],
  agentsById: Map<string, ReleaseAgentInfo>,
  now: Date,
): ReleaseDecision[] {
  const out: ReleaseDecision[] = [];
  for (const a of assignments) {
    const agent = agentsById.get(a.agentId);
    if (!agent) continue; // owning agent missing (deleted/paused) — leave for manual cleanup

    // segment_exit: continuous agent — user no longer matches the segment audience.
    if (agent.enrollmentMode === "continuous" && agent.audience && !agent.audience.has(a.externalUserId)) {
      out.push({ id: a.id, externalUserId: a.externalUserId, reason: "segment_exit" });
      continue;
    }
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
