import { describe, expect, it, mock } from "bun:test";
import { NextResponse } from "next/server";

let authkitCalls = 0;

mock.module("@workos-inc/authkit-nextjs", () => ({
  authkit: async () => {
    authkitCalls++;
    return { session: { user: null }, headers: new Headers() };
  },
  handleAuthkitProxy: () => NextResponse.next(),
  applyResponseHeaders: (res: NextResponse) => res,
  partitionAuthkitHeaders: () => ({ requestHeaders: new Headers(), responseHeaders: new Headers() }),
}));

const { NextRequest } = await import("next/server");
const { middleware } = await import("../../src/middleware");

describe("middleware public service routes", () => {
  it("does not pass ingest bearer requests through WorkOS auth", async () => {
    authkitCalls = 0;

    const req = new NextRequest("https://nexus.youversion.com/api/ingest/users", {
      headers: { Authorization: "Bearer test_ingest_key" },
    });

    const res = await middleware(req);

    expect(authkitCalls).toBe(0);
    expect(res).toBeDefined();
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(200);
  });
});
