/**
 * Shared `unstable_cache` wrappers for expensive DB queries, split by domain.
 *
 * Two-layer caching:
 *   ISR (`revalidate` on pages) → CDN-cached HTML, <100ms on hit
 *   unstable_cache here → server-side data cache; when ISR misses, re-render
 *   reads from here instead of hitting the DB (~50ms vs ~1.5s).
 *
 * Tag taxonomy:
 *   "agents"           — any agent mutation (create/update/delete)
 *   "agent-${id}"      — specific agent mutation
 *   "personas"         — persona changes
 *   "dashboard-stats"  — new decisions recorded (busted hourly by cron)
 *   "user-count"       — total tracked-user count (long TTL; cron never busts it)
 *   "performance"      — new decisions recorded
 *   "segments"         — HT segment membership (busted by POST /api/ingest/segments)
 *   "funnel-breakdown" — funnel stage distribution (long TTL; not busted hourly)
 *   "lift-settings"    — lift config (busted by settings API)
 *   "push-taxonomy"    — push category/subcategory tree (busted on taxonomy mutations)
 *
 * Braze campaign stats live in `@/lib/braze/analytics` (getCachedBrazeStats) —
 * they wrap an external HTTP call, not a DB query, so they don't belong here.
 */
export { TTL } from "./ttl";
export * from "./agents";
export * from "./personas";
export * from "./dashboard";
export * from "./performance";
export * from "./segments";
export * from "./push-taxonomy";
