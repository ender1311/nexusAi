/**
 * Pure cohort selection for the select-and-send cron. Given an already-filtered
 * pool of eligible externalIds (persona/funnel/segment/consent + fleet-exclusivity
 * applied upstream), randomly sample up to `cap` of them. No DB access; RNG
 * injectable for deterministic tests.
 */

/** Fisher-Yates shuffle on a copy. RNG injectable. */
function shuffled<T>(arr: readonly T[], random: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Randomly select up to `cap` members from `eligible`. Returns all of them when
 * the pool is smaller than the cap; empty when the pool is empty or cap <= 0.
 */
export function selectCohort(
  eligible: readonly string[],
  cap: number,
  random: () => number = Math.random,
): string[] {
  if (cap <= 0 || eligible.length === 0) return [];
  if (eligible.length <= cap) return [...eligible];
  return shuffled(eligible, random).slice(0, cap);
}
