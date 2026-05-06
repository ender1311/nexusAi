/**
 * Beta distribution PDF utilities for the Reward Intelligence Panel.
 *
 * Uses Lanczos approximation (g=7) for log-gamma, which is accurate to ~15 decimal places.
 * All functions are pure — no side effects.
 */

/** Lanczos coefficients for g=7 */
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS_C[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    x += LANCZOS_C[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

export type PDFPoint = { x: number; y: number };

/**
 * Compute n (x, y) points for the Beta(alpha, beta) PDF over (0, 1).
 * Returns points suitable for Recharts AreaChart.
 *
 * @param alpha - Shape parameter α. Must be ≥ 1 (Thompson Sampling initializes at α=1).
 * @param beta  - Shape parameter β. Must be ≥ 1 (Thompson Sampling initializes at β=30).
 * @param n     - Number of sample points (default 50).
 */
export function betaPDFPoints(alpha: number, beta: number, n = 50): PDFPoint[] {
  const lb = logBeta(alpha, beta);
  const points: PDFPoint[] = [];

  for (let i = 0; i < n; i++) {
    // Avoid endpoints 0 and 1 where PDF can be infinite
    const x = 0.01 + (0.98 * i) / (n - 1);
    const logY = (alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x) - lb;
    const y = Math.exp(logY);
    // Unreachable for α,β ≥ 1; defensive guard for UI safety
    points.push({ x, y: isFinite(y) ? y : 0 });
  }

  return points;
}

/**
 * Compute recency multiplier for arm selection demotion.
 * Formula: max(0.2, exp(-0.3 * daysSinceSent))
 * - undefined (never sent): 1.0 (no penalty)
 * - 0 days: 1.0 (same-day sends not demoted — exp(-0.3 * 0) = 1.0)
 * - 1 day:  ~0.74
 * - 2 days: ~0.55
 * - 5+ days: ≥0.22 (floor at 0.2)
 */
export function recencyMultiplier(daysSinceSent: number | undefined): number {
  if (daysSinceSent === undefined) return 1.0;
  return Math.max(0.2, Math.exp(-0.3 * daysSinceSent));
}
