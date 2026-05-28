import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";

// Mutable auth state — mutate per test to simulate admin vs non-admin
const mockAuth: { roles: string[] } = { roles: [] };

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

// Import AFTER mock.module so the mock takes effect
const { GET, POST, DELETE } = await import("@/app/api/test-users/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.roles = [];
});
afterEach(async () => {
  await truncateAll();
});

describe("GET /api/test-users", () => {
  it("returns empty array when no test users exist", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeArray();
    expect(body.data).toHaveLength(0);
  });

  it("returns only test users", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "test-001", attributes: { name: "Tester", _is_test_user: true } },
    });
    await prisma.trackedUser.create({
      data: { externalId: "real-001", attributes: { name: "Real User" } },
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].externalId).toBe("test-001");
    expect(body.data[0].name).toBe("Tester");
  });
});

describe("POST /api/test-users", () => {
  it("returns 403 when not admin", async () => {
    mockAuth.roles = [];
    const req = buildRequest("POST", { name: "Alice", externalId: "u-alice" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(403);
  });

  it("creates a test user as admin", async () => {
    mockAuth.roles = ["admin"];
    const req = buildRequest("POST", { name: "Alice", externalId: "u-alice" });
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.externalId).toBe("u-alice");
    expect(body.data.name).toBe("Alice");

    const stored = await prisma.trackedUser.findUnique({ where: { externalId: "u-alice" } });
    expect(stored).not.toBeNull();
  });

  it("upserts an existing test user", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "u-alice", attributes: { name: "Old Name", _is_test_user: true } },
    });

    mockAuth.roles = ["admin"];
    const req = buildRequest("POST", { name: "Alice Updated", externalId: "u-alice" });
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.name).toBe("Alice Updated");
  });

  it("returns 400 when name is missing", async () => {
    mockAuth.roles = ["admin"];
    const req = buildRequest("POST", { externalId: "u-alice" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("returns 400 when externalId is missing", async () => {
    mockAuth.roles = ["admin"];
    const req = buildRequest("POST", { name: "Alice" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/test-users", () => {
  it("returns 403 when not admin", async () => {
    mockAuth.roles = [];
    const req = new Request("http://localhost/?externalId=u-alice", { method: "DELETE" });
    const res = await DELETE(req as NextRequest);
    expect(res.status).toBe(403);
  });

  it("deletes an existing test user as admin", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "u-alice", attributes: { name: "Alice", _is_test_user: true } },
    });

    mockAuth.roles = ["admin"];
    const req = new Request("http://localhost/?externalId=u-alice", { method: "DELETE" });
    const res = await DELETE(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const stored = await prisma.trackedUser.findUnique({ where: { externalId: "u-alice" } });
    expect(stored).toBeNull();
  });

  it("returns 400 when externalId param is missing", async () => {
    mockAuth.roles = ["admin"];
    const req = new Request("http://localhost/", { method: "DELETE" });
    const res = await DELETE(req as NextRequest);
    expect(res.status).toBe(400);
  });
});
