/**
 * Pure audience helpers for the select-and-send cron. No DB access — the
 * orchestrator supplies counts and applies the returned trims.
 */

/** True when two clock hours are within ±1, wrapping across midnight. */
function hoursAdjacent(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 - diff) <= 1;
}

/**
 * Hard ceiling on rows pulled per agent per cron run. Guards the all-null
 * "unlimited" case so a query can never be unbounded and blow the 300s timeout.
 */
export const MAX_FETCH_LIMIT = 50_000;

/**
 * Decide how many eligible users to pull from the DB for one agent in one run.
 * Cohort agents need at least `uniqueUsersCap` candidates to sample N; send-rate
 * agents need ~2x `dailySendCap` for suppression headroom. Take the larger of the
 * two drivers; when both are null the agent is unlimited, so fall back to the
 * safety ceiling. Result is always bounded by MAX_FETCH_LIMIT.
 */
export function resolveFetchLimit(dailySendCap: number | null, uniqueUsersCap: number | null): number {
  const fromDaily = dailySendCap != null ? dailySendCap * 2 : 0;
  const fromCohort = uniqueUsersCap != null ? uniqueUsersCap : 0;
  const want = Math.max(fromDaily, fromCohort);
  if (want === 0) return MAX_FETCH_LIMIT;
  return Math.min(want, MAX_FETCH_LIMIT);
}

/**
 * Trim a list to a remaining quota. `remaining <= 0` drops everything; otherwise
 * keeps the first `remaining`. Returns the kept ids and how many were dropped.
 */
export function trimToCap(userIds: string[], remaining: number): { kept: string[]; suppressed: number } {
  if (remaining <= 0) return { kept: [], suppressed: userIds.length };
  if (userIds.length > remaining) return { kept: userIds.slice(0, remaining), suppressed: userIds.length - remaining };
  return { kept: userIds, suppressed: 0 };
}

export type HourPartition = { kept: string[]; deferred: number };

/**
 * Preserve send-timing fairness without a per-run cap. When `prioritizeLastSeen`
 * is on, keep users whose preferred send hour is within ±1 of the current UTC hour
 * (plus users with no preference); users whose preferred hour is far from now are
 * DEFERRED to their matching hourly run (NOT suppressed — they send later today).
 * When off, everyone is kept. No numeric ceiling — `dailySendCap` is the ramp knob.
 */
export function partitionByPreferredHour(
  userIds: string[],
  opts: {
    prioritizeLastSeen: boolean;
    currentHour: number;
    preferredHourByUser: Map<string, number | null>;
  },
): HourPartition {
  const { prioritizeLastSeen, currentHour, preferredHourByUser } = opts;
  if (!prioritizeLastSeen) return { kept: [...userIds], deferred: 0 };

  const kept: string[] = [];
  let deferred = 0;
  for (const uid of userIds) {
    const h = preferredHourByUser.get(uid);
    if (h !== null && h !== undefined) {
      if (hoursAdjacent(h, currentHour)) kept.push(uid);
      else deferred++; // deferred to its matching hourly run — not suppressed
    } else {
      kept.push(uid); // no preference → eligible now
    }
  }
  return { kept, deferred };
}
