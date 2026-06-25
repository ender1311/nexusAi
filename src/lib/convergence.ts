import type { FunnelStage } from "@/types/agent";

// Illustrative sends per user per month by funnel stage — approximate eligibility
// cadence, NOT a value read from the cron (real throughput is further cut by
// frequency caps, quiet hours, and daily send caps). One eligibility cycle =
// 30 / sendsPerMonth days.
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
// Convergence is gated by how fast *informative* signal accrues, which depends
// on three things, not just audience size:
//   1. Eligibility cadence — how often a user can be sent to (funnel stage).
//   2. Base engagement rate — what fraction of sends produce a signal (an open).
//      This is the factor a naive "sends per cycle" model misses: a lapsed user
//      reached at scale still opens ~1% of the time, so most sends are
//      uninformative zeros and far more are needed to separate variants.
//   3. Segment size — how many distinct users can be sent to in parallel.

// Engaged responses (opens) per arm needed for the Beta posteriors to narrow
// enough that the best arm wins draws consistently. This counts *positive*
// signals, not raw sends (see sendsToConverge).
//
// IMPORTANT: 40 is an optimistic floor. It assumes (a) the variants differ by a
// clear margin — near-tied arms need far more, scaling ~1/Δ² in the reward gap —
// and (b) an uninformed prior. The engine actually cold-starts arms at a
// skeptical Beta(1,30), so early sends barely move the posterior and real
// convergence runs longer than this constant implies. Treat outputs as best-case.
export const OBS_PER_ARM = 40;

// Illustrative base push-open rate by funnel stage — the fraction of sends that
// yield an engagement signal, the dominant driver of convergence speed: a low
// rate means most sends are uninformative, so many more are needed. Approximate,
// in the ~1–5% range Nexus sees for push opens. NOTE: this is the right signal
// rate only for engagement-goal agents; conversion-goal agents (gifts,
// subscriptions) have far lower base rates (<1%) and so converge much slower.
export const OPEN_RATE: Partial<Record<FunnelStage, number>> = {
  dau4:        0.05,
  wau:         0.03,
  mau:         0.02,
  lapsed_dau4: 0.01,
  lapsed_wau:  0.01,
  lapsed_mau:  0.01,
  new:         0.05,
};

export function openRateForStage(stage: FunnelStage | ""): number | null {
  if (!stage) return null;
  return OPEN_RATE[stage as FunnelStage] ?? null;
}

// One eligibility cycle in hours = (30 / sendsPerMonth) days. Null for stages
// with no defined send cadence.
export function cycleHours(stage: FunnelStage | ""): number | null {
  if (!stage) return null;
  const spm = SENDS_PER_MONTH[stage as FunnelStage];
  if (spm === undefined) return null;
  return (30 / spm) * 24;
}

// Engaged responses needed across all arms before convergence (positive signals).
export function observationsNeeded(arms: number): number {
  return Math.max(0, Math.round(arms)) * OBS_PER_ARM;
}

// Total sends needed to converge: to gather OBS_PER_ARM opens on each of `arms`
// arms at the stage's base open rate, you must send arms × OBS_PER_ARM / openRate
// times. Null for stages without a defined open rate.
export function sendsToConverge(stage: FunnelStage | "", arms: number): number | null {
  const p = openRateForStage(stage);
  if (p === null || p <= 0 || arms < 1) return null;
  return Math.ceil((Math.round(arms) * OBS_PER_ARM) / p);
}

// Distinct users that receive an exploratory send before convergence: the total
// sends needed, capped at the segment (a smaller segment means users are re-sent
// across cycles rather than reaching more people). Per-stage because the send
// count depends on the stage's open rate.
export function peopleExplored(
  stage: FunnelStage | "",
  arms: number,
  segmentSize: number,
): number {
  const sends = sendsToConverge(stage, arms);
  if (sends === null) return 0;
  return Math.min(Math.max(0, Math.floor(segmentSize)), sends);
}

// Convergence time given an explicit segment size. Sends accrue at
// segmentSize / cycleHours per hour (one send per user per eligibility cycle,
// spread across the cycle), and sendsToConverge sends are needed:
//   hours = sendsToConverge / (segmentSize / cycleHours)
//         = arms × OBS_PER_ARM × cycleHours / (openRate × segmentSize)
// Returns null when the stage cadence/open rate, arm count, or segment is invalid.
export function convergenceHoursForSegment(
  stage: FunnelStage | "",
  arms: number,
  segmentSize: number,
): number | null {
  const ch = cycleHours(stage);
  const sends = sendsToConverge(stage, arms);
  if (ch === null || sends === null || segmentSize < 1) return null;
  return (sends * ch) / segmentSize;
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
