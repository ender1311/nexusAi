import { describe, expect, it, mock } from "bun:test";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

let authProxyCalls = 0;

mock.module("@workos-inc/authkit-nextjs", () => ({
  authkitProxy: () => () => {
    authProxyCalls++;
    return NextResponse.json({ proxied: true }, { status: 418 });
  },
}));

const { middleware } = await import("../../src/middleware");

describe("middleware public service routes", () => {
  it("does not pass ingest bearer requests through WorkOS proxy", async () => {
    authProxyCalls = 0;

    const req = new NextRequest("https://nexus.youversion.com/api/ingest/users", {
      headers: { Authorization: "Bearer test_ingest_key" },
    });

    const res = await middleware(req, {} as NextFetchEvent);

    expect(authProxyCalls).toBe(0);
    expect(res).toBeDefined();
    if (!res) throw new Error("Expected middleware response");
    expect(res.status).toBe(200);
  });
});
