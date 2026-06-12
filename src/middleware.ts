import { NextRequest, NextResponse } from "next/server";
import {
  authkit,
  handleAuthkitProxy,
  applyResponseHeaders,
  partitionAuthkitHeaders,
} from "@workos-inc/authkit-nextjs";
import { isPublic, isServiceRoute } from "@/lib/auth/route-access";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isServiceRoute(pathname)) {
    return NextResponse.next();
  }

  const cookieName = process.env.WORKOS_COOKIE_NAME ?? "wos-session";
  const hasSessionCookie = request.cookies.has(cookieName);

  // No session cookie at all on a protected route → straight to login. There is
  // deliberately no bearer-token escape hatch here: machine routes are already
  // whitelisted via SERVICE_PREFIXES, so a bearer header on any other route is
  // not proof of anything (it used to skip session auth entirely, leaving every
  // GET API route readable with `Authorization: Bearer x`).
  if (!isPublic(pathname) && !hasSessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // A cookie exists (or this is a public route): validate the ACTUAL session.
  // authkit() verifies the access token and attempts a refresh. Cookie *presence*
  // is not proof of a valid session — an expired/stale cookie that can no longer be
  // refreshed previously slipped past the presence check, leaving logged-out users
  // on a chrome-less, non-interactive "cached" view until they manually signed out.
  // When the session can't be validated, session.user is null and the returned
  // headers clear the stale cookie, so we redirect to /login instead.
  const { session, headers } = await authkit(request);

  if (!session.user && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return applyResponseHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        partitionAuthkitHeaders(request, headers).responseHeaders,
      );
    }
    return handleAuthkitProxy(request, headers, { redirect: "/login" });
  }

  // Authenticated, or a public path — pass through with the (possibly refreshed)
  // session headers so withAuth() resolves the user in server components.
  return handleAuthkitProxy(request, headers);
}

export const config = {
  matcher: [
    // Exclude static assets, images, and machine-to-machine API routes.
    // Service routes (/api/ingest/, /api/cron/, /api/decide, /api/admin/,
    // /api/revalidate) authenticate per-request via API key / CRON_SECRET;
    // they don't need WorkOS session middleware, and skipping it here eliminates
    // ~600K+ unnecessary middleware invocations per 14 days.
    "/((?!_next/static|_next/image|favicon\\.ico|api/ingest/|api/cron/|api/decide|api/admin/|api/revalidate|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
