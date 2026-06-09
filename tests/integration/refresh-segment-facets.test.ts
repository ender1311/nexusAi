import { describe, expect, it, beforeAll, afterAll, beforeEach } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/refresh-segment-facets/route";
import { truncateAll, prisma } from "../helpers/db";
import { createUser } from "../helpers/builders";

beforeAll(() => { process.env.CRON_SECRET = "test_cron_secret"; });
afterAll(() => { delete process.env.CRON_SECRET; });

function authedReq(): NextRequest {
  return new NextRequest("http://localhost/api/cron/refresh-segment-facets", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

describe("POST /api/cron/refresh-segment-facets", () => {
  beforeEach(async () => { await truncateAll(); });

  it("rejects an unauthenticated request with 401", async () => {
    const req = new NextRequest("http://localhost/api/cron/refresh-segment-facets", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("computes a values facet for country with counts desc", async () => {
    await createUser("u1", { attributes: { country_latest: "US" } });
    await createUser("u2", { attributes: { country_latest: "US" } });
    await createUser("u3", { attributes: { country_latest: "GB" } });

    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { refreshed: string[]; failed: string[] } };
    expect(body.data.refreshed).toContain("country_latest");

    const row = await prisma.segmentFieldFacet.findUnique({ where: { fieldId: "country_latest" } });
    expect(row?.kind).toBe("values");
    const payload = row!.payload as { top: { value: string; count: number }[]; total: number };
    expect(payload.top[0]).toEqual({ value: "US", count: 2 });
    expect(payload.top.find((t) => t.value === "GB")?.count).toBe(1);
    expect(payload.total).toBe(3);
  });

  it("computes a range facet for a numeric field", async () => {
    await createUser("u1", { totalDecisions: 0 });
    await createUser("u2", { totalDecisions: 10 });
    await createUser("u3", { totalDecisions: 100 });

    await POST(authedReq());

    const row = await prisma.segmentFieldFacet.findUnique({ where: { fieldId: "totalDecisions" } });
    expect(row?.kind).toBe("range");
    const payload = row!.payload as { min: number; max: number };
    expect(Number(payload.min)).toBe(0);
    expect(Number(payload.max)).toBe(100);
  });
});
