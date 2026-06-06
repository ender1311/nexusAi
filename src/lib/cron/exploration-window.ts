/**
 * Pure Phase-0 logic for the select-and-send cron: decide which lapsed/connected
 * users enter (or stay in) an exploration window, and which expired windows to
 * close. No DB access — the orchestrator fetches inputs and applies the returned
 * write sets.
 */

import { isPushPreferred, isNewsletterOptedOut, type PushTargetingMode } from "@/lib/engine/channel-preference";
import { parseSegmentTargeting } from "@/lib/agent-targeting";

export type ExplorationAgent = {
  id: string;
  funnelStage: string | null;
  languageFilter: string | null;
  targetSegmentName: string | null;
  segmentTargeting: unknown;
  personaTargets: { personaId: string }[];
  messages: { channel: string }[];
};

export type ExplorationUser = {
  externalId: string;
  personaId: string | null;
  funnelStage: string | null;
  attributes: unknown;
  channelStats: unknown;
};

export type ExistingAssignment = {
  id: string;
  externalUserId: string;
  agentId: string;
  startedAt: Date;
  windowCompletedAt: Date | null;
};

/**
 * For each user, the list of exploration agents they're eligible for, respecting
 * persona membership, channel opt-out, language, and funnel-stage filters.
 */
export function buildEligibleAgentsByUser(
  agents: ExplorationAgent[],
  users: ExplorationUser[],
  pushTargetingMode: PushTargetingMode,
): Map<string, string[]> {
  const agentPersonaSets = new Map<string, Set<string>>();
  for (const agent of agents) {
    agentPersonaSets.set(agent.id, new Set(agent.personaTargets.map((pt) => pt.personaId)));
  }

  const eligibleAgentsByUser = new Map<string, string[]>();
  for (const user of users) {
    if (!user.personaId) continue;
    const eligible: string[] = [];
    for (const agent of agents) {
      if (!agentPersonaSets.get(agent.id)?.has(user.personaId)) continue;
      const attrs = (user.attributes as Record<string, unknown>) ?? {};
      // Channel eligibility: newsletter_*_enabled must not be opted out (opt-out model).
      const agentHasPush = agent.messages.some((m) => m.channel === "push");
      if (agentHasPush && isNewsletterOptedOut(attrs, "push")) continue;
      const agentHasEmail = agent.messages.some((m) => m.channel === "email");
      if (agentHasEmail && isNewsletterOptedOut(attrs, "email")) continue;
      // Preferred-channel gate: push agents only target users whose behavioral
      // preferred external channel is push (mode-dependent; see channel-preference.ts).
      if (agentHasPush && !isPushPreferred(attrs, user.channelStats, user.funnelStage, pushTargetingMode)) continue;
      // Language filter: agent.languageFilter takes precedence; push agents default to English-only.
      const effectiveLang =
        agent.languageFilter && agent.languageFilter !== "all"
          ? agent.languageFilter
          : agentHasPush
            ? "en"
            : null;
      if (effectiveLang) {
        const lang = attrs?.language_tag as string | undefined;
        if (!lang?.startsWith(effectiveLang)) continue;
      }
      // Funnel-stage filter (skipped when segment targeting is active — membership is the filter).
      const hasSegmentIncludes = !!parseSegmentTargeting(agent.segmentTargeting)?.includes?.length;
      if (!agent.targetSegmentName && !hasSegmentIncludes && agent.funnelStage && user.funnelStage !== agent.funnelStage) continue;
      eligible.push(agent.id);
    }
    if (eligible.length > 0) eligibleAgentsByUser.set(user.externalId, eligible);
  }
  return eligibleAgentsByUser;
}

export type WindowClassification = {
  /** Class A — newly eligible users with no prior assignment. */
  toCreate: Array<{ externalUserId: string; agentId: string }>;
  /** Class D — assignments whose cooldown expired; start a fresh window. */
  toReset: Array<{ externalUserId: string; agentId: string }>;
  /** Class C — assignment IDs whose 8-day window expired without 4 sends. */
  toClose: string[];
  /** externalUserId → agentId for users actively in a window this run. */
  inWindowMap: Map<string, string>;
};

/** Uniform random pick from a non-empty list. */
function defaultPickAgent(agentIds: string[]): string {
  return agentIds[Math.floor(Math.random() * agentIds.length)];
}

export function classifyExplorationWindows(
  users: ExplorationUser[],
  assignmentByUser: Map<string, ExistingAssignment>,
  eligibleAgentsByUser: Map<string, string[]>,
  opts: { now: Date; windowMs: number; cooldownMs: number; pickAgent?: (agentIds: string[]) => string },
): WindowClassification {
  const { now, windowMs, cooldownMs, pickAgent = defaultPickAgent } = opts;
  const toCreate: WindowClassification["toCreate"] = [];
  const toReset: WindowClassification["toReset"] = [];
  const toClose: string[] = [];
  const inWindowMap = new Map<string, string>();

  for (const user of users) {
    const assignment = assignmentByUser.get(user.externalId);

    if (!assignment) {
      // Class A: no prior assignment — newly eligible
      const eligible = eligibleAgentsByUser.get(user.externalId) ?? [];
      if (eligible.length === 0) continue;
      const agentId = pickAgent(eligible);
      toCreate.push({ externalUserId: user.externalId, agentId });
      inWindowMap.set(user.externalId, agentId);
    } else if (assignment.windowCompletedAt === null) {
      const age = now.getTime() - assignment.startedAt.getTime();
      if (age <= windowMs) {
        // Class B: active window — keep locked
        inWindowMap.set(user.externalId, assignment.agentId);
      } else {
        // Class C: 8 days elapsed, never hit 4 sends — close window
        toClose.push(assignment.id);
      }
    } else {
      const timeSinceComplete = now.getTime() - assignment.windowCompletedAt.getTime();
      if (timeSinceComplete > cooldownMs) {
        // Class D: cooldown expired — new window
        const eligible = eligibleAgentsByUser.get(user.externalId) ?? [];
        if (eligible.length === 0) continue;
        const agentId = pickAgent(eligible);
        toReset.push({ externalUserId: user.externalId, agentId });
        inWindowMap.set(user.externalId, agentId);
      }
      // Class E: cooldown not yet expired — no action
    }
  }

  return { toCreate, toReset, toClose, inWindowMap };
}
