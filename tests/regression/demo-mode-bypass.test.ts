import { afterEach, describe, expect, it, mock } from "bun:test";
import { NextResponse } from "next/server";

let authkitCalls = 0;

mock.module("@workos-inc/authkit-nextjs", () => ({
  authkit: async () => {
    authkitCalls++;
    return { session: { user: null }, headers: new Headers() };
  },
  withAuth: async () => ({ user: null, roles: [] }),
  signOut: async () => {},
  handleAuthkitProxy: () => NextResponse.next(),
  applyResponseHeaders: (res: NextResponse) => res,
  partitionAuthkitHeaders: () => ({ requestHeaders: new Headers(), responseHeaders: new Headers() }),
}));

const { NextRequest } = await import("next/server");
const { middleware } = await import("../../src/middleware");
const { getAuth } = await import("../../src/lib/auth");

afterEach(() => {
  delete process.env.DEMO_MODE;
});

describe("DEMO_MODE auth bypass", () => {
  it("passes a protected page through without touching WorkOS or redirecting to /login", async () => {
    process.env.DEMO_MODE = "true";
    authkitCalls = 0;

    const res = await middleware(new NextRequest("https://demo.example.com/"));

    expect(authkitCalls).toBe(0);
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects to /login when DEMO_MODE is off", async () => {
    authkitCalls = 0;

    const res = await middleware(new NextRequest("https://demo.example.com/"));

    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("resolves a regular (non-admin) demo user, never an admin", async () => {
    process.env.DEMO_MODE = "true";

    const auth = await getAuth();

    expect(auth.user?.email).toBe("demo@nexus.app");
    expect(auth.isAdmin).toBe(false);
    expect(auth.canManageLibrary).toBe(false);
  });
});
