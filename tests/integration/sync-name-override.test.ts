import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";

// Overridable auth so we can exercise the non-admin 403 path.
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

// Import AFTER mock.module so the auth mock takes effect.
const { PUT, DELETE } = await import("@/app/api/hightouch/syncs/[id]/name/route");

import { NextRequest } from "next/server";

function req(method: "PUT" | "DELETE", body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/hightouch/syncs/2770929/name", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const params = { params: Promise.resolve({ id: "2770929" }) };

beforeEach(async () => { await truncateAll(); mockAuth.roles = ["admin"]; });
afterEach(async () => { await truncateAll(); mockAuth.roles = ["admin"]; });

describe("PUT/DELETE /api/hightouch/syncs/[id]/name", () => {
  it("PUT creates an override and returns { data: { syncId, displayName } }", async () => {
    const res = await PUT(req("PUT", { displayName: "Push Opens" }), params);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { syncId: string; displayName: string } };
    expect(json.data).toEqual({ syncId: "2770929", displayName: "Push Opens" });

    const row = await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } });
    expect(row!.displayName).toBe("Push Opens");
  });

  it("PUT upserts (updates an existing override)", async () => {
    await prisma.syncNameOverride.create({ data: { syncId: "2770929", displayName: "Old" } });
    const res = await PUT(req("PUT", { displayName: "New Name" }), params);
    expect(res.status).toBe(200);
    const row = await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } });
    expect(row!.displayName).toBe("New Name");
  });

  it("PUT trims surrounding whitespace before storing", async () => {
    await PUT(req("PUT", { displayName: "  Trimmed  " }), params);
    const row = await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } });
    expect(row!.displayName).toBe("Trimmed");
  });

  it("PUT rejects empty / whitespace-only with 400", async () => {
    expect((await PUT(req("PUT", { displayName: "" }), params)).status).toBe(400);
    expect((await PUT(req("PUT", { displayName: "   " }), params)).status).toBe(400);
  });

  it("PUT rejects a non-string or over-long name with 400", async () => {
    expect((await PUT(req("PUT", { displayName: 123 }), params)).status).toBe(400);
    expect((await PUT(req("PUT", { displayName: "x".repeat(101) }), params)).status).toBe(400);
  });

  it("PUT rejects a non-admin caller with 403 before any write", async () => {
    mockAuth.roles = [];
    const res = await PUT(req("PUT", { displayName: "Nope" }), params);
    expect(res.status).toBe(403);
    expect(await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } })).toBeNull();
  });

  it("DELETE clears the override and returns { data: { syncId } }", async () => {
    await prisma.syncNameOverride.create({ data: { syncId: "2770929", displayName: "Old" } });
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { syncId: string } };
    expect(json.data).toEqual({ syncId: "2770929" });
    expect(await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } })).toBeNull();
  });

  it("DELETE is idempotent (200 when no override exists)", async () => {
    expect((await DELETE(req("DELETE"), params)).status).toBe(200);
  });

  it("DELETE rejects a non-admin caller with 403", async () => {
    mockAuth.roles = [];
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  });
});
