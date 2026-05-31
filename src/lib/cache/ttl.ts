/**
 * Shared revalidate windows (seconds) for the `unstable_cache` wrappers.
 * Replaces ad-hoc 900 / 14400 / 86400 literals scattered across the cache modules.
 */
export const TTL = {
  /** Standard server-data cache window for dashboard/agent/performance reads. */
  STANDARD: 900,
  /** Slow-moving aggregates (funnel breakdown, Braze stats) — 4 hours. */
  LONG: 14400,
  /** Full-table counts and settings that change at most a few times a day. */
  DAY: 86400,
} as const;
