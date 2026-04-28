import { authkitProxy } from "@workos-inc/authkit-nextjs";

/**
 * Protect all UI routes with WorkOS AuthKit.
 * Service-to-service API routes use their own auth (API keys / CRON_SECRET)
 * and must stay publicly reachable.
 */
export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      // WorkOS OAuth callback — must be reachable before session exists
      "/callback",
      // Hightouch → Nexus data sync (HIGHTOUCH_API_KEY / INGEST_API_KEY)
      "/api/ingest/(.*)",
      "/api/decide",
      // Vercel cron (CRON_SECRET)
      "/api/cron/(.*)",
      // Admin endpoints (CRON_SECRET)
      "/api/admin/(.*)",
    ],
  },
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
