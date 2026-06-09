import { isInteractionFlag, normalizeFlag } from "@/lib/constants/interaction-flags";

type FlagGoal = { eventName: string; conversionType: string | null };

/**
 * Pure: decide which interaction-flag goals to credit on a user sync.
 * - first_interaction (Type A): flag is now true AND was false/absent at enrollment.
 * - any_interaction  (Type B): flag is now true (baseline irrelevant).
 * Returns the list of flag eventNames to credit (deduped, only those the agent
 * actually has a matching goal for).
 */
export function detectFlagConversions(args: {
  incoming: Record<string, unknown>;
  stored: Record<string, unknown>;
  enrollmentFlags: Record<string, unknown>;
  goals: FlagGoal[];
}): string[] {
  const { incoming, enrollmentFlags, goals } = args;
  const credited = new Set<string>();
  for (const g of goals) {
    if (!g.conversionType) continue;
    if (!isInteractionFlag(g.eventName)) continue;
    const nowTrue = normalizeFlag(incoming[g.eventName]);
    if (!nowTrue) continue;
    if (g.conversionType === "first_interaction") {
      const baseTrue = normalizeFlag(enrollmentFlags[g.eventName]);
      if (baseTrue) continue; // already interacted before enrollment — not a first interaction
    }
    credited.add(g.eventName);
  }
  return [...credited];
}
