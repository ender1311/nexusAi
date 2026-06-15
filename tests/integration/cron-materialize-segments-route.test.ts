import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { POST, GET } from "@/app/api/cron/materialize-segments/route";
import { NextRequest } from "next/server";

function cronRequest(token: string | null, method: "POST" | "GET" = "POST"): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/cron/materialize-segments", { method, headers });
}

describe("POST /api/cron/materialize-segments", () => {
  beforeAll(() => {
    process.env.CRON_SECRET = "test_cron_secret";
  });
  afterAll(() => {
    delete process.env.CRON_SECRET;
  });
  beforeEach(async () => {
    await prisma.cronRun.deleteMany({ where: { cronName: "materialize-segments" } });
  });

  it("rejects a missing/invalid bearer token with 401", async () => {
    const res = await POST(cronRequest(null));
    expect(res.status).toBe(401);
    const badRes = await POST(cronRequest("wrong-secret"));
    expect(badRes.status).toBe(401);
  });

  it("returns { data: summary } and writes a CronRun on valid auth", async () => {
    const res = await POST(cronRequest(process.env.CRON_SECRET ?? ""));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { runStart: string; segmentsProcessed: number } };
    expect(typeof json.data.runStart).toBe("string");
    expect(typeof json.data.segmentsProcessed).toBe("number");

    const runs = await prisma.cronRun.findMany({ where: { cronName: "materialize-segments" } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
  });

  // Vercel Cron Jobs invoke routes with GET — the route must handle GET or the
  // scheduled run silently 405s and segments never materialize.
  it("GET (the method Vercel cron uses) runs the same: 401 unauthed, 200 + CronRun authed", async () => {
    expect((await GET(cronRequest(null, "GET"))).status).toBe(401);
    const res = await GET(cronRequest(process.env.CRON_SECRET ?? "", "GET"));
    expect(res.status).toBe(200);
    const runs = await prisma.cronRun.findMany({ where: { cronName: "materialize-segments" } });
    expect(runs).toHaveLength(1);
  });
});
