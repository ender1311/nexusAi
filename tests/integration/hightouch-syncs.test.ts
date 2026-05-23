import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { NextRequest } from "next/server";

// Mock WorkOS before importing any routes that call requireAdmin()
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () => Promise.resolve({ user: null, roles: [], sessionId: null, accessToken: null }),
  signOut: async () => {},
}));

const { GET: getSyncs } = await import("@/app/api/hightouch/syncs/route");
const { GET: getSyncRuns } = await import("@/app/api/hightouch/syncs/[id]/runs/route");
const { POST: triggerSync } = await import("@/app/api/hightouch/syncs/[id]/trigger/route");
const { GET: getModels } = await import("@/app/api/hightouch/models/route");
const { GET: getSources } = await import("@/app/api/hightouch/sources/route");
const { GET: getDestinations } = await import("@/app/api/hightouch/destinations/route");
import { buildRequest } from "../helpers/request";

beforeEach(() => {
  delete process.env.HIGHTOUCH_API_KEY;
});

afterEach(() => {
  delete process.env.HIGHTOUCH_API_KEY;
});

describe("GET /api/hightouch/syncs", () => {
  it("returns empty data when Hightouch not configured", async () => {
    const res = await getSyncs();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/hightouch/models", () => {
  it("returns empty data when Hightouch not configured", async () => {
    const res = await getModels();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/hightouch/sources", () => {
  it("returns empty data when Hightouch not configured", async () => {
    const res = await getSources();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/hightouch/destinations", () => {
  it("returns empty data when Hightouch not configured", async () => {
    const res = await getDestinations();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/hightouch/syncs/[id]/runs", () => {
  it("returns empty data for sync runs when Hightouch not configured", async () => {
    const req = buildRequest("GET");
    const res = await getSyncRuns(req as NextRequest, {
      params: Promise.resolve({ id: "sync_123" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns 400 for invalid limit param", async () => {
    const req = new NextRequest(
      "http://localhost/api/hightouch/syncs/sync_123/runs?limit=abc"
    );
    const res = await getSyncRuns(req, {
      params: Promise.resolve({ id: "sync_123" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit of zero", async () => {
    const req = new NextRequest(
      "http://localhost/api/hightouch/syncs/sync_123/runs?limit=0"
    );
    const res = await getSyncRuns(req, {
      params: Promise.resolve({ id: "sync_123" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/hightouch/syncs/[id]/trigger", () => {
  // requireAdmin() calls WorkOS withAuth() which requires a valid session.
  // In the test environment there is no WorkOS session, so isAdmin is false
  // and requireAdmin() returns 403 Forbidden before reaching the client check.
  it("returns 403 when triggering sync without admin auth", async () => {
    const req = buildRequest("POST", {});
    const res = await triggerSync(req as NextRequest, {
      params: Promise.resolve({ id: "sync_123" }),
    });
    expect(res.status).toBe(403);
  });
});
