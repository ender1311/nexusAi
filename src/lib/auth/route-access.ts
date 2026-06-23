/**
 * Route-access policy for the WorkOS middleware. Pure data + predicates so the
 * policy is unit-testable without invoking the middleware itself.
 */

/** Paths that never require a WorkOS session (login flow + machine endpoints). */
export const PUBLIC_PREFIXES = [
  "/login",
  "/callback",
  // Service-to-service API routes — use their own API-key / secret auth
  "/api/ingest/",
  "/api/decide",
  "/api/cron/",
  "/api/admin/",
  "/api/revalidate",
] as const;

/**
 * Machine-to-machine routes that authenticate per-request (API key, CRON_SECRET,
 * REVALIDATE_SECRET). Middleware passes these straight through; everything else
 * requires a valid WorkOS session — there is intentionally NO bearer-token bypass
 * for non-service routes (a bare `Authorization: Bearer x` header used to skip
 * session auth entirely, exposing every GET API route unauthenticated).
 */
export const SERVICE_PREFIXES = [
  "/api/ingest/",
  "/api/decide",
  "/api/cron/",
  "/api/admin/",
  "/api/revalidate",
] as const;

/**
 * Segment-bounded prefix match. A prefix matches the path itself or any
 * sub-path under it, but NOT a sibling that merely shares a string prefix:
 * `/api/decide` matches `/api/decide` and `/api/decide/x`, never
 * `/api/decide-preview`. Trailing slashes on entries are normalized away so
 * `/api/ingest/` and `/api/decide` behave identically.
 */
function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => {
    const base = p.endsWith("/") ? p.slice(0, -1) : p;
    return pathname === base || pathname.startsWith(base + "/");
  });
}

export function isPublic(pathname: string): boolean {
  return matchesPrefix(pathname, PUBLIC_PREFIXES);
}

export function isServiceRoute(pathname: string): boolean {
  return matchesPrefix(pathname, SERVICE_PREFIXES);
}
