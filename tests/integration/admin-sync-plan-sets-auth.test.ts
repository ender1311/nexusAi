import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/admin/sync-plan-sets/route";
import { NextRequest } from "next/server";

function req(token: string | null): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/admin/sync-plan-sets", { method: "POST", headers });
}

// /api/admin/ is a SERVICE_PREFIX, so this route bypasses the WorkOS session
// middleware and self-authenticates via CRON_SECRET. It previously used a plain
// `token !== process.env.CRON_SECRET`, which FAILS OPEN when CRON_SECRET is
// unset (undefined !== undefined → false → request authorized). These tests pin
// the fail-closed behavior.
describe("POST /api/admin/sync-plan-sets auth", () => {
  beforeEach(async () => {
    // Empty plan-set table → the handler's loop is skipped and no external
    // YouVersion fetch happens, so the valid-auth case stays network-free.
    await prisma.planSetMember.deleteMany();
    await prisma.planSet.deleteMany();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects a missing bearer token with 401", async () => {
    process.env.CRON_SECRET = "test_admin_secret";
    expect((await POST(req(null))).status).toBe(401);
  });

  it("rejects a wrong bearer token with 401", async () => {
    process.env.CRON_SECRET = "test_admin_secret";
    expect((await POST(req("wrong-secret"))).status).toBe(401);
  });

  // Regression: must FAIL CLOSED when CRON_SECRET is unset (no header → no
  // accidental `undefined === undefined` bypass).
  it("rejects with 401 when CRON_SECRET is unset, even with no auth header", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req(null))).status).toBe(401);
    expect((await POST(req(""))).status).toBe(401);
  });

  it("authorizes a valid bearer token", async () => {
    process.env.CRON_SECRET = "test_admin_secret";
    const res = await POST(req("test_admin_secret"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; results: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.results).toEqual([]);
  });
});
