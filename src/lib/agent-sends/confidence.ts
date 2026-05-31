export type ConfidenceLevel = "high" | "moderate" | "exploratory";

export type ScoreSummary = {
  /** Variant scores sorted high → low as [variantId, score]. */
  sorted: [string, number][];
  totalScore: number;
  winnerScore: number;
  /** Winning variant's share of total score, 0–100, rounded. */
  winnerSharePct: number;
  maxScore: number;
};

/** Summarizes a decision's per-variant Thompson/UCB draw scores. */
export function summarizeVariantScores(scores: Record<string, number>): ScoreSummary {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const totalScore = sorted.reduce((s, [, v]) => s + v, 0);
  const winnerScore = sorted[0]?.[1] ?? 0;
  const winnerSharePct = totalScore > 0 ? Math.round((winnerScore / totalScore) * 100) : 0;
  const maxScore = sorted[0]?.[1] ?? 1;
  return { sorted, totalScore, winnerScore, winnerSharePct, maxScore };
}

/**
 * Maps the winner's score share to a confidence level.
 * >=70% = high; >=40% = moderate; otherwise exploratory.
 */
export function classifyConfidence(winnerSharePct: number): ConfidenceLevel {
  if (winnerSharePct >= 70) return "high";
  if (winnerSharePct >= 40) return "moderate";
  return "exploratory";
}
