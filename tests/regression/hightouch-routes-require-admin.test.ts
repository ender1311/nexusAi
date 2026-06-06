// Regression: the Hightouch read routes (syncs, models, sources, destinations,
// and sync runs) were unauthenticated GET handlers. They expose warehouse model
// SQL, source/destination config, and sync run error messages — sensitive
// operational data that must not be world-readable. Each must now reject a
// non-admin caller with 403 before touching the Hightouch client.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

const mockAuth: { roles: string[] } = { roles: ["admin"] };

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Avoid any real network: a configured client that returns canned data.
mock.module("@/lib/hightouch/client", () => ({
  createHightouchClient: () => ({
    listSyncs: async () => [{ id: "s1" }],
    listModels: async () => [{ id: "m1" }],
    listSources: async () => [{ id: "src1" }],
    listDestinations: async () => [{ id: "d1" }],
    getSyncRuns: async () => [{ id: "r1" }],
  }),
}));

const { GET: getSyncs } = await import("@/app/api/hightouch/syncs/route");
const { GET: getModels } = await import("@/app/api/hightouch/models/route");
const { GET: getSources } = await import("@/app/api/hightouch/sources/route");
const { GET: getDestinations } = await import("@/app/api/hightouch/destinations/route");
const { GET: getRuns } = await import("@/app/api/hightouch/syncs/[id]/runs/route");

function runsReq() {
  return new NextRequest("http://localhost/api/hightouch/syncs/s1/runs");
}
const runsParams = { params: Promise.resolve({ id: "s1" }) };

beforeEach(() => {
  mockAuth.roles = ["admin"];
});
afterEach(() => {
  mockAuth.roles = ["admin"];
});

describe("Hightouch read routes require admin", () => {
  it("returns 403 for a non-admin on every read route", async () => {
    mockAuth.roles = [];
    expect((await getSyncs()).status).toBe(403);
    expect((await getModels()).status).toBe(403);
    expect((await getSources()).status).toBe(403);
    expect((await getDestinations()).status).toBe(403);
    expect((await getRuns(runsReq(), runsParams)).status).toBe(403);
  });

  it("allows an admin through to the data", async () => {
    mockAuth.roles = ["admin"];
    const res = await getSyncs();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);

    expect((await getModels()).status).toBe(200);
    expect((await getSources()).status).toBe(200);
    expect((await getDestinations()).status).toBe(200);
    expect((await getRuns(runsReq(), runsParams)).status).toBe(200);
  });
});
