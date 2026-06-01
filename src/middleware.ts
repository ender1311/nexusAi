import { NextRequest, NextResponse } from "next/server";
import {
  authkit,
  handleAuthkitProxy,
  applyResponseHeaders,
  partitionAuthkitHeaders,
} from "@workos-inc/authkit-nextjs";

const PUBLIC_PREFIXES = [
  "/login",
  "/callback",
  // Service-to-service API routes — use their own API-key / CRON_SECRET auth
  "/api/ingest/",
  "/api/decide",
  "/api/cron/",
  "/api/admin/",
];

const SERVICE_PREFIXES = [
  "/api/ingest/",
  "/api/decide",
  "/api/cron/",
  "/api/admin/",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isServiceRoute(pathname: string): boolean {
  return SERVICE_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isServiceRoute(pathname)) {
    return NextResponse.next();
  }

  const cookieName = process.env.WORKOS_COOKIE_NAME ?? "wos-session";
  // Bearer-token requests (cron, ingest, machine-to-machine) carry their own auth — let them through.
  const hasBearerToken = request.headers.get("authorization")?.startsWith("Bearer ");
  const hasSessionCookie = request.cookies.has(cookieName);

  // No session cookie at all on a protected route → straight to login.
  if (!isPublic(pathname) && !hasSessionCookie && !hasBearerToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // A cookie exists (or this is a public/bearer route): validate the ACTUAL session.
  // authkit() verifies the access token and attempts a refresh. Cookie *presence*
  // is not proof of a valid session — an expired/stale cookie that can no longer be
  // refreshed previously slipped past the presence check, leaving logged-out users
  // on a chrome-less, non-interactive "cached" view until they manually signed out.
  // When the session can't be validated, session.user is null and the returned
  // headers clear the stale cookie, so we redirect to /login instead.
  const { session, headers } = await authkit(request);

  if (!session.user && !isPublic(pathname) && !hasBearerToken) {
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
