import { Goal } from "@/types/agent";

const TIER_BASE_REWARDS: Record<string, number> = {
  best: 10,
  very_good: 7,
  good: 5,
  bad: -2,
  very_bad: -5,
  worst: -10,
};

// Synthetic "funnel_recovery" event: reward scaled by how high the user climbed.
// rank 1=mau, 2=wau, 3=dau4 → tier good/very_good/best → 0.25 / 0.35 / 0.50.
// Only used when no explicit agent Goal for "funnel_recovery" exists.
const RECOVERY_RANK_TIER: Record<number, string> = { 1: "good", 2: "very_good", 3: "best" };
const RECOVERY_WEIGHT = 5; // tunable

/**
 * Calculate normalized reward for a conversion event given the agent's goals.
 * Returns a reward in [-1, 1] range after normalization.
 *
 * When a goal has weightMode="property", reads the numeric value from
 * eventProperties[goal.weightProperty] and uses it as the multiplier instead
 * of the fixed valueWeight. Falls back to weightDefault if the property is missing.
 */
export function calculateReward(
  conversionEvent: string,
  goals: Goal[],
  eventProperties?: Record<string, unknown>
): number {
  const matchingGoal = goals.find((g) => g.eventName === conversionEvent);
  if (!matchingGoal) {
    // Built-in funnel_recovery reward when the agent has no explicit Goal for it.
    if (conversionEvent === "funnel_recovery") {
      const rank = Number(eventProperties?.recovery_rank);
      const tier = RECOVERY_RANK_TIER[rank];
      if (!tier) return 0;
      const base = TIER_BASE_REWARDS[tier] ?? 0;
      return Math.max(-1, Math.min(1, (base * RECOVERY_WEIGHT) / 100));
    }
    return 0;
  }

  const baseReward = TIER_BASE_REWARDS[matchingGoal.tier] ?? 0;

  let weight: number;
  if (matchingGoal.weightMode === "property" && matchingGoal.weightProperty && eventProperties) {
    const propValue = eventProperties[matchingGoal.weightProperty];
    // Number(null) and Number("") both coerce to a finite 0, which would silently
    // skip the weightDefault fallback for a missing/blank property. Only a real
    // number or a non-blank numeric string counts as present.
    const numericValue =
      typeof propValue === "number"
        ? propValue
        : typeof propValue === "string" && propValue.trim() !== ""
          ? Number(propValue)
          : NaN;
    weight = isFinite(numericValue) ? numericValue : (matchingGoal.weightDefault ?? 1.0);
  } else {
    weight = matchingGoal.valueWeight;
  }

  return Math.max(-1, Math.min(1, (baseReward * weight) / 100));
}

/**
 * Calculate cumulative reward for multiple conversion events.
 */
export function calculateCumulativeReward(
  events: string[],
  goals: Goal[],
  eventProperties?: Record<string, unknown>
): number {
  return events.reduce((sum, event) => sum + calculateReward(event, goals, eventProperties), 0);
}
