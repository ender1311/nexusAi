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

export function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isServiceRoute(pathname: string): boolean {
  return SERVICE_PREFIXES.some((p) => pathname.startsWith(p));
}
