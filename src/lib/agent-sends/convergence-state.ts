import type { SendRow } from "./types";

export type ConvergenceState = "exploring" | "learning" | "converging" | "confident";

export type VariantTally = { name: string; count: number; conversions: number };

export type VariantDistribution = {
  entries: VariantTally[];
  total: number;
  topShare: number;
  state: ConvergenceState;
};

/**
 * Maps the leading variant's share of sends to a learning state.
 * Thresholds: <20 sends or <35% share = exploring; <50% = learning;
 * <70% = converging; otherwise confident.
 */
export function classifyConvergence(total: number, topShare: number): ConvergenceState {
  if (total < 20 || topShare < 0.35) return "exploring";
  if (topShare < 0.5) return "learning";
  if (topShare < 0.7) return "converging";
  return "confident";
}

/** Tallies sends + conversions per variant and derives the convergence state. */
export function computeVariantDistribution(
  rows: Pick<SendRow, "variantId" | "variantName" | "reward">[],
): VariantDistribution {
  const map = new Map<string, VariantTally>();
  for (const row of rows) {
    if (!row.variantId && !row.variantName) continue;
    const key = row.variantId ?? row.variantName!;
    const name = row.variantName ?? key.slice(-6);
    const entry = map.get(key) ?? { name, count: 0, conversions: 0 };
    entry.count++;
    if (row.reward != null && row.reward > 0) entry.conversions++;
    map.set(key, entry);
  }
  const entries = [...map.values()].sort((a, b) => b.count - a.count);
  const total = entries.reduce((s, e) => s + e.count, 0);
  const topShare = total > 0 && entries.length > 0 ? entries[0].count / total : 0;
  return { entries, total, topShare, state: classifyConvergence(total, topShare) };
}
