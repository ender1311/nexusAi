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

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

const authProxy = authkitProxy();

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // Redirect unauthenticated users to login before delegating to WorkOS proxy
  const cookieName = process.env.WORKOS_COOKIE_NAME ?? "wos-session";
  if (!request.cookies.has(cookieName)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Delegate to WorkOS authkit proxy to refresh session cookies as needed
  return authProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
