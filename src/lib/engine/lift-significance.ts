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

export type BaselineLiftResult = {
  /** Nexus rate as a percentage (e.g. 3.3 for 3.3%) */
  nexusRate: number;
  /** Absolute lift in percentage points: nexusRate - baselineRatePct */
  absoluteLift: number;
  /** Relative lift in percent: absoluteLift / baselineRatePct × 100 */
  relativeLift: number;
  /** True when |z| > 1.96 AND nexusSends >= MIN_SENDS */
  significant: boolean;
  /** True when nexusSends < MIN_SENDS — significance verdict withheld */
  insufficient: boolean;
  /** One-proportion z-score; 0 when insufficient */
  zScore: number;
  /** Raw nexusSends for display */
  nexusSends: number;
};

/**
 * One-proportion z-test: compares Nexus conversion rate against a known
 * fixed baseline rate (non-Nexus push open rate).
 *
 * z = (p̂ − p₀) / sqrt(p₀ × (1 − p₀) / n)
 *
 * where p̂ = nexusRate/100, p₀ = baselineRatePct/100, n = nexusSends.
 * Significant when |z| > 1.96 (p < 0.05) AND nexusSends >= MIN_SENDS.
 *
 * @param nexusSends      Total scored sends (reward IS NOT NULL)
 * @param nexusConversions Sends where reward > 0
 * @param baselineRatePct Non-Nexus open rate as a percentage (e.g. 1.2)
 */
export function baselineLiftSignificance(
  nexusSends: number,
  nexusConversions: number,
  baselineRatePct: number,
): BaselineLiftResult {
  const nexusRate = nexusSends > 0 ? (nexusConversions / nexusSends) * 100 : 0;
  const absoluteLift = nexusSends > 0 ? nexusRate - baselineRatePct : 0;
  const relativeLift = nexusSends > 0 && baselineRatePct !== 0 ? (absoluteLift / baselineRatePct) * 100 : 0;

  if (nexusSends < MIN_SENDS_FOR_SIGNIFICANCE) {
    return {
      nexusRate,
      absoluteLift,
      relativeLift,
      significant: false,
      insufficient: true,
      zScore: 0,
      nexusSends,
    };
  }

  // One-proportion z-test (baseline is a fixed known rate, not a sample)
  const p0 = baselineRatePct / 100;
  const pHat = nexusRate / 100;
  const se = Math.sqrt((p0 * (1 - p0)) / nexusSends);
  const zScore = se > 0 ? (pHat - p0) / se : 0;
  const significant = Math.abs(zScore) > 1.96;

  return { nexusRate, absoluteLift, relativeLift, significant, insufficient: false, zScore, nexusSends };
}
