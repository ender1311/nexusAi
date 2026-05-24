import type { FunnelStage } from "@/types/agent";

// Base convergence hours for 3 arms — midpoints of ranges shown in the Architecture table.
// These represent "minimum eligibility cycles × cycle duration", anchored to real send frequencies.
const BASE_HOURS_3_ARMS: Partial<Record<FunnelStage, number>> = {
  dau4:        12,    // "Hours to 1 day"  (0.5 day midpoint)
  wau:         84,    // "Days to 1 week"  (3.5 days midpoint)
  mau:         504,   // "2–4 weeks"       (21 days midpoint)
  lapsed_dau4: 1008,  // "Weeks to months" (6 weeks midpoint)
  lapsed_dau:  1008,
  lapsed_wau:  1008,
  lapsed_mau:  1008,
  new:         12,
};

// Convergence scales linearly with arm count: each additional arm needs ~40 observations,
// and arms share the available audience equally per send cycle.
export function convergenceHours(funnelStage: FunnelStage | "", arms: number): number | null {
  if (!funnelStage || arms < 1) return null;
  const base = BASE_HOURS_3_ARMS[funnelStage as FunnelStage];
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
