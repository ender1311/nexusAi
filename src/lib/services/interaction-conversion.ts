import { isInteractionFlag, normalizeFlag } from "@/lib/constants/interaction-flags";

type FlagGoal = { eventName: string; conversionType: string | null };

/**
 * Pure: decide which interaction-flag goals to credit on a user sync.
 * - first_interaction (Type A): flag is now true AND was false/absent at enrollment.
 * - any_interaction  (Type B): flag flipped false/absent → true THIS sync
 *   (stored pre-upsert value was not true). Without the transition gate a
 *   has-ever flag that stays true re-credited the same conversion on every
 *   subsequent sync, and users already engaged before enrollment got credit
 *   the agent never earned (2026-06-09 audit, finding C2).
 *
 * enrollmentFlags may be null when the assignment's stored baseline is missing
 * or corrupt. Coercing that to "all false" let Type A credit users who were
 * already engaged before enrollment (2026-06-09 audit, I1); instead, fall back
 * to the pre-upsert stored attributes as a conservative baseline — a flag that
 * was already true before this sync cannot be a first interaction.
 *
 * Returns the list of flag eventNames to credit (deduped, only those the agent
 * actually has a matching goal for).
 */
export function detectFlagConversions(args: {
  incoming: Record<string, unknown>;
  stored: Record<string, unknown>;
  enrollmentFlags: Record<string, unknown> | null;
  goals: FlagGoal[];
}): string[] {
  const { incoming, stored, enrollmentFlags, goals } = args;
  const credited = new Set<string>();
  for (const g of goals) {
    if (!g.conversionType) continue;
    if (!isInteractionFlag(g.eventName)) continue;
    const nowTrue = normalizeFlag(incoming[g.eventName]);
    if (!nowTrue) continue;
    if (g.conversionType === "first_interaction") {
      const baseline = enrollmentFlags ?? stored;
      const baseTrue = normalizeFlag(baseline[g.eventName]);
      if (baseTrue) continue; // already interacted before enrollment — not a first interaction
    }
    if (g.conversionType === "any_interaction") {
      if (normalizeFlag(stored[g.eventName])) continue; // was already true — no transition, no credit
    }
    credited.add(g.eventName);
  }
  return [...credited];
}
