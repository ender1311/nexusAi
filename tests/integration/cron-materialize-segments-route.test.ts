import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/cron/materialize-segments/route";
import { NextRequest } from "next/server";

function cronRequest(token: string | null): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/cron/materialize-segments", { method: "POST", headers });
}

describe("POST /api/cron/materialize-segments", () => {
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
});
