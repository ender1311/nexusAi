// Pure copy helpers for dynamic giving handles. No DB / IO.

/** Default dollars→Bibles ratio: $1/month ≈ 24 Bible apps distributed per year. */
export const DEFAULT_DOLLARS_TO_BIBLES = 24;

/**
 * Parse the giving_dollars_to_bibles_multiplier AppSetting value.
 * Falls back to DEFAULT_DOLLARS_TO_BIBLES when blank, non-numeric, or ≤ 0 —
 * a misconfigured setting still produces a valid (default) impact figure.
 */
export function parseMultiplier(raw: string | null | undefined): number {
  const n = Number(raw ?? "");
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DOLLARS_TO_BIBLES;
}

/**
 * Bibles distributed = round(amountUsd × multiplier). USD-based because the
 * relationship is dollars × multiplier. Non-finite/≤0 amounts yield 0.
 */
export function computeBibles(amountUsd: number, multiplier: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  return Math.round(amountUsd * multiplier);
}

/**
 * Replace {{ask}} (already-formatted currency string) and {{bibles}} (integer,
 * rendered with locale thousands separators) in copy. Unknown tokens are left
 * untouched; text with no placeholders passes through unchanged.
 */
export function substituteGivingCopy(
  text: string,
  vals: { amountDisplay: string; bibles: number },
): string {
  return text
    .replaceAll("{{ask}}", vals.amountDisplay)
    .replaceAll("{{bibles}}", vals.bibles.toLocaleString("en-US"));
}
