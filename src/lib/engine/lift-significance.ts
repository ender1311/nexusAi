/**
 * Statistical significance testing for agent lift vs. fleet average.
 *
 * Uses a two-proportion z-test at the 95% confidence level (z > 1.96, p < 0.05).
 * The fleet includes the agent under measurement, which is a minor violation of
 * independence but acceptable when there are multiple agents — the agent's share
 * of fleet sends is small and doesn't materially skew the baseline.
 *
 * Minimum sample size: 200 agent sends. Below this threshold the test has too
 * little power to detect realistic effect sizes, so we surface "insufficient data"
 * rather than a potentially misleading significance verdict.
 */

export const MIN_SENDS_FOR_SIGNIFICANCE = 200;

export type LiftResult = {
  /** Lift in percentage points: (agentConvRate - fleetConvRate) * 100 */
  lift: number;
  /** True when |z| > 1.96 (p < 0.05, two-tailed) and agentSends >= MIN_SENDS */
  significant: boolean;
  /** True when agentSends < MIN_SENDS — significance verdict is withheld */
  insufficient: boolean;
  /** Raw z-score from the two-proportion z-test; 0 when insufficient */
  zScore: number;
};

export function liftSignificance(
  agentSends: number,
  agentConversions: number,
  fleetSends: number,
  fleetConversions: number,
): LiftResult {
  const p1 = agentSends > 0 ? agentConversions / agentSends : 0;
  const p2 = fleetSends > 0 ? fleetConversions / fleetSends : 0;
  const lift = (p1 - p2) * 100;

  if (agentSends < MIN_SENDS_FOR_SIGNIFICANCE) {
    return { lift, significant: false, insufficient: true, zScore: 0 };
  }

  const totalSends = agentSends + fleetSends;
  if (totalSends === 0) {
    return { lift: 0, significant: false, insufficient: true, zScore: 0 };
  }

  // Pooled proportion under the null hypothesis (no difference between rates)
  const pPool = (agentConversions + fleetConversions) / totalSends;
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / agentSends + 1 / fleetSends));

  // Guard: if se = 0 (e.g. pPool = 0 or 1), z is undefined — treat as not significant
  const zScore = se > 0 ? (p1 - p2) / se : 0;
  const significant = Math.abs(zScore) > 1.96;

  return { lift, significant, insufficient: false, zScore };
}
