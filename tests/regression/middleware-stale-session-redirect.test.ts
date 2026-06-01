// Regression: logged-out users with a stale/expired WorkOS session cookie were
// served a chrome-less, non-interactive "cached" view instead of the login prompt.
// The old middleware only checked cookie *presence* (request.cookies.has), so an
// expired cookie that could no longer be refreshed slipped past the auth gate and
// withAuth() then resolved to a null user. The fix validates the actual session via
// authkit() and redirects to /login when session.user is null.
import { describe, expect, it, mock } from "bun:test";
import { NextResponse } from "next/server";

// Controllable session result for authkit() — flip per test.
let sessionUser: { id: string } | null = null;

mock.module("@workos-inc/authkit-nextjs", () => ({
  authkit: async () => ({
    session: { user: sessionUser },
    // Simulate the cookie-clearing Set-Cookie the real proxy returns on refresh failure.
    headers: new Headers({ "set-cookie": "wos-session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT" }),
  }),
  handleAuthkitProxy: (req: import("next/server").NextRequest, _headers: Headers, opts?: { redirect?: string }) =>
    opts?.redirect
      ? NextResponse.redirect(new URL(opts.redirect, req.url))
      : NextResponse.next(),
  applyResponseHeaders: (res: NextResponse) => res,
  partitionAuthkitHeaders: () => ({ requestHeaders: new Headers(), responseHeaders: new Headers() }),
}));

const { NextRequest } = await import("next/server");
const { middleware } = await import("../../src/middleware");

describe("middleware stale-session handling", () => {
  it("redirects to /login when a session cookie exists but is invalid", async () => {
    sessionUser = null; // refresh failed → no valid user

    const req = new NextRequest("https://nexus.youversion.com/");
    req.cookies.set("wos-session", "stale-and-expired");

    const res = await middleware(req);

    expect(res).toBeDefined();
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("returns 401 JSON for a protected API route with an invalid session cookie", async () => {
    sessionUser = null;

    const req = new NextRequest("https://nexus.youversion.com/api/agents");
    req.cookies.set("wos-session", "stale-and-expired");

    const res = await middleware(req);

    expect(res).toBeDefined();
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(401);
  });

  it("passes authenticated requests through without redirecting", async () => {
    sessionUser = { id: "user_123" }; // valid, refreshed session

    const req = new NextRequest("https://nexus.youversion.com/");
    req.cookies.set("wos-session", "valid");

    const res = await middleware(req);

    expect(res).toBeDefined();
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects to /login without validating when no cookie is present", async () => {
    sessionUser = { id: "should-not-be-read" };

    const req = new NextRequest("https://nexus.youversion.com/agents");

    const res = await middleware(req);

    expect(res).toBeDefined();
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
