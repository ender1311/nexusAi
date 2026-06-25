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

// ── Segment-aware convergence ────────────────────────────────────────────────
// The model above assumes a "large enough" audience. When the segment size is an
// explicit input, convergence becomes throughput-bound: each eligibility cycle
// delivers up to `segmentSize` observations (one send per user), so a small
// segment — or a high arm count — is what actually slows learning down.

// Observations per arm needed for the Beta posteriors to narrow enough that the
// best arm wins draws consistently (~30–50; 40 is the working midpoint).
export const OBS_PER_ARM = 40;

// One eligibility cycle in hours = (30 / sendsPerMonth) days. Null for stages
// with no defined send cadence.
export function cycleHours(stage: FunnelStage | ""): number | null {
  if (!stage) return null;
  const spm = SENDS_PER_MONTH[stage as FunnelStage];
  if (spm === undefined) return null;
  return (30 / spm) * 24;
}

// Total exploratory observations the bandit must gather before it converges.
export function observationsNeeded(arms: number): number {
  return Math.max(0, Math.round(arms)) * OBS_PER_ARM;
}

// Distinct users that receive an exploratory send before convergence. Capped at
// the segment: when the segment is smaller than the exploration budget, every
// user is explored (and re-sent across cycles).
export function peopleExplored(arms: number, segmentSize: number): number {
  return Math.min(Math.max(0, Math.floor(segmentSize)), observationsNeeded(arms));
}

// Convergence time given an explicit segment size:
//   hours = arms × OBS_PER_ARM × cycleHours / segmentSize
// Returns null when the stage cadence, arm count, or segment size is invalid.
export function convergenceHoursForSegment(
  stage: FunnelStage | "",
  arms: number,
  segmentSize: number,
): number | null {
  const ch = cycleHours(stage);
  if (ch === null || arms < 1 || segmentSize < 1) return null;
  return (observationsNeeded(arms) * ch) / segmentSize;
}

// Snap an arm count to the nearest multiple of 5 for the slider, with a floor of
// 5 and the same 10 000 ceiling as the log scale. The manual input bypasses this
// so any integer is still reachable by typing.
export function snapArms(arms: number): number {
  const snapped = Math.round(arms / 5) * 5;
  return Math.max(5, Math.min(10_000, snapped));
}

// Map a linear slider position (0–100) to an arm count on a log scale (3–10 000).
export function sliderPosToArms(pos: number): number {
  return Math.round(3 * Math.pow(10_000 / 3, pos / 100));
}

export function armsToSliderPos(arms: number): number {
  return Math.round(Math.log(arms / 3) / Math.log(10_000 / 3) * 100);
}
