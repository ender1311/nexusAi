/**
 * Computes the minimal PATCH/PUT payloads needed to persist user edits in the
 * unified Settings tab. Editor builds two snapshots (initial vs. current) of the
 * same flat shape; this routes each changed field to the correct endpoint:
 * agent-level fields → PATCH /api/agents/[id], scheduling fields → PUT
 * /api/agents/[id]/scheduling. Fields are compared by JSON.stringify since all
 * tracked values are small JSON-safe shapes (primitives or plain objects/arrays).
 */

export const AGENT_FIELDS = [
  "name",
  "description",
  "color",
  "algorithm",
  "epsilon",
  "funnelStage",
  "targetSegmentName",
  "segmentTargeting",
  "enrollmentMode",
  "dailySendCap",
  "uniqueUsersCap",
  "fallbackSendHour",
  "deeplinkOverride",
  "languageFilter",
  "localizePush",
] as const;

export const SCHEDULING_FIELDS = [
  "frequencyCap",
  "quietHours",
  "blackoutDates",
  "smartSuppress",
  "suppressThresh",
  "prioritizeLastSeen",
] as const;

export type AgentField = (typeof AGENT_FIELDS)[number];
export type SchedulingField = (typeof SCHEDULING_FIELDS)[number];
export type SettingsField = AgentField | SchedulingField;

export type SettingsSnapshot = Partial<Record<SettingsField, unknown>>;

export type DiffResult = {
  agentPatch: Record<string, unknown> | null;
  schedulingPut: Record<string, unknown> | null;
};

function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function diffAgentSettings(
  initial: SettingsSnapshot,
  edited: SettingsSnapshot,
): DiffResult {
  const agentPatch: Record<string, unknown> = {};
  for (const key of AGENT_FIELDS) {
    if (edited[key] === undefined) continue;
    if (changed(initial[key], edited[key])) {
      agentPatch[key] = edited[key];
    }
  }

  const schedulingPut: Record<string, unknown> = {};
  for (const key of SCHEDULING_FIELDS) {
    if (edited[key] === undefined) continue;
    if (changed(initial[key], edited[key])) {
      schedulingPut[key] = edited[key];
    }
  }

  return {
    agentPatch: Object.keys(agentPatch).length > 0 ? agentPatch : null,
    schedulingPut: Object.keys(schedulingPut).length > 0 ? schedulingPut : null,
  };
}
