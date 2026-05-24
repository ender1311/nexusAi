import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { authkitProxy } from "@workos-inc/authkit-nextjs";

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

const authProxy = authkitProxy();

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (isServiceRoute(pathname)) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users away from protected routes before handing off
  // to WorkOS proxy. Public routes still go through authProxy so withAuth() works
  // in the root layout (which renders on every page including /login).
  const cookieName = process.env.WORKOS_COOKIE_NAME ?? "wos-session";
  // Bearer-token requests (cron, ingest, machine-to-machine) carry their own auth — let them through
  const hasBearerToken = request.headers.get("authorization")?.startsWith("Bearer ");
  if (!isPublic(pathname) && !request.cookies.has(cookieName) && !hasBearerToken) {
    // API routes return 401 JSON; page routes redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Always delegate to WorkOS authkit proxy — required for withAuth() to work
  return authProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
