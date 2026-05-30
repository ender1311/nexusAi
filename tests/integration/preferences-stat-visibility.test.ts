import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";

// Mutable auth state — mutate per test to simulate signed-in vs anonymous
const mockAuth: { user: { id: string; email: string } | null } = {
  user: { id: "user_pref_1", email: "test@youversion.com" },
};

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: mockAuth.user
        ? { ...mockAuth.user, firstName: null, lastName: null }
        : null,
      roles: [],
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { GET, PUT } = await import("@/app/api/preferences/stat-visibility/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.user = { id: "user_pref_1", email: "test@youversion.com" };
});
afterEach(async () => {
  await truncateAll();
});

describe("GET /api/preferences/stat-visibility", () => {
  it("returns empty hiddenStats when no preference row exists", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hiddenStats).toEqual([]);
  });

  it("returns stored hiddenStats for the current user", async () => {
    await prisma.userPreference.create({
      data: {
        workosUserId: "user_pref_1",
        hiddenStats: JSON.stringify(["agent.algorithm", "dashboard.totalSends"]),
      },
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hiddenStats.sort()).toEqual(["agent.algorithm", "dashboard.totalSends"]);
  });

  it("returns 401 when no user is signed in", async () => {
    mockAuth.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/preferences/stat-visibility", () => {
  it("creates a preference row on first save", async () => {
    const res = await PUT(buildRequest("PUT", { hiddenStats: ["agent.decisions"] }) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hiddenStats).toEqual(["agent.decisions"]);

    const stored = await prisma.userPreference.findUnique({
      where: { workosUserId: "user_pref_1" },
    });
    expect(stored?.hiddenStats).toBe(JSON.stringify(["agent.decisions"]));
  });

  it("updates an existing preference row", async () => {
    await prisma.userPreference.create({
      data: { workosUserId: "user_pref_1", hiddenStats: JSON.stringify(["agent.algorithm"]) },
    });
    const res = await PUT(buildRequest("PUT", { hiddenStats: ["dashboard.totalSends"] }) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hiddenStats).toEqual(["dashboard.totalSends"]);

    const count = await prisma.userPreference.count({ where: { workosUserId: "user_pref_1" } });
    expect(count).toBe(1);
  });

  it("filters unknown keys and dedupes before storing", async () => {
    const res = await PUT(
      buildRequest("PUT", { hiddenStats: ["agent.decisions", "bogus.key", "agent.decisions"] }) as NextRequest
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hiddenStats).toEqual(["agent.decisions"]);
  });

  it("treats a non-array hiddenStats as empty", async () => {
    const res = await PUT(buildRequest("PUT", { hiddenStats: "agent.decisions" }) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.hiddenStats).toEqual([]);
  });

  it("returns 401 when no user is signed in", async () => {
    mockAuth.user = null;
    const res = await PUT(buildRequest("PUT", { hiddenStats: [] }) as NextRequest);
    expect(res.status).toBe(401);
  });
});
