import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";

// Mutable auth state — null user = unauthenticated, roles controls admin access
const mockAuth: {
  user: { id: string; email: string; firstName: null; lastName: null } | null;
  roles: string[];
} = {
  user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
  roles: ["admin"],
};

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: mockAuth.user,
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { POST } = await import("@/app/api/demo/send/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.user = { id: "u1", email: "test@youversion.com", firstName: null, lastName: null };
  mockAuth.roles = ["admin"];
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/demo/send — auth", () => {
  it("returns 403 without admin auth", async () => {
    mockAuth.user = null;
    mockAuth.roles = [];
    const req = buildRequest("POST", { agentId: "agent-1", userIds: ["183037114"] }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

describe("POST /api/demo/send — input validation", () => {
  it("returns 400 when agentId is missing", async () => {
    const req = buildRequest("POST", { userIds: ["183037114"] }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 when userIds is empty", async () => {
    const req = buildRequest("POST", { agentId: "agent-1", userIds: [] }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 when userIds has more than 20 entries", async () => {
    const userIds = Array.from({ length: 21 }, (_, i) => String(i + 1));
    const req = buildRequest("POST", { agentId: "agent-1", userIds }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/20/);
  });
});
