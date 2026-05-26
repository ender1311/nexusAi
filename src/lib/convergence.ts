import type { FunnelStage } from "@/types/agent";

// Actual sends per user per month by funnel stage (matches cron targeting logic).
// Convergence time per arm = 30 / sendsPerMonth days = one eligibility cycle.
// For a large enough audience the bandit needs ~1 cycle to reach 40 obs/arm.
export const SENDS_PER_MONTH: Partial<Record<FunnelStage, number>> = {
  dau4:        25,   // ~20–30 sends/month (daily eligible)
  wau:          9,   // ~6–12 sends/month  (1–3×/week)
  mau:          4,   // 4 sends/month      (real send cadence)
  lapsed_dau4:  2,   // 2 sends/month      (real send cadence)
  lapsed_wau:   2,
  lapsed_mau:   2,
  new:         25,
};

// Base convergence for 3 arms = one eligibility cycle = (30 / sendsPerMonth) × 24 hours.
function baseHours3Arms(stage: FunnelStage): number | undefined {
  const spm = SENDS_PER_MONTH[stage];
  if (spm === undefined) return undefined;
  return (30 / spm) * 24;
}

// Convergence scales linearly with arm count: each additional arm needs ~40 observations,
// and arms share the available audience equally per send cycle.
export function convergenceHours(funnelStage: FunnelStage | "", arms: number): number | null {
  if (!funnelStage || arms < 1) return null;
  const base = baseHours3Arms(funnelStage as FunnelStage);
  if (base === undefined) return null;
  return base * (arms / 3);
}

export function formatConvergenceTime(hours: number): string {
  if (hours < 2) return "< 2 hours";
  if (hours < 24) return `~${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days < 1.5) return "~1 day";
  if (days < 7) return `~${Math.round(days)} days`;
  const weeks = days / 7;
  if (weeks < 1.5) return "~1 week";
  if (weeks < 8) return `~${Math.round(weeks)} weeks`;
  const months = days / 30.5;
  if (months < 1.5) return "~1 month";
  if (months < 24) return `~${Math.round(months)} months`;
  const years = days / 365;
  return `~${Math.round(years)} years`;
}

export function estimateConvergence(funnelStage: FunnelStage | "", arms: number): string {
  const h = convergenceHours(funnelStage, arms);
  return h === null ? "—" : formatConvergenceTime(h);
}

// Map a linear slider position (0–100) to an arm count on a log scale (3–10 000).
export function sliderPosToArms(pos: number): number {
  return Math.round(3 * Math.pow(10_000 / 3, pos / 100));
}

export function armsToSliderPos(arms: number): number {
  return Math.round(Math.log(arms / 3) / Math.log(10_000 / 3) * 100);
}
