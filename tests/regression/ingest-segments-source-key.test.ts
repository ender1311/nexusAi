// Regression: widening UserSegment's unique constraint to include `source`
// (C3 spec, 2026-06-07) changed the Hightouch ingest upsert's compound key from
// `externalId_segmentName` to `externalId_segmentName_source`. This guards that
// the ingest path still upserts correctly and stamps source='hightouch'.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/ingest/segments/route";
import { NextRequest } from "next/server";

function ingestRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ingest/segments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.INGEST_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ingest/segments source key", () => {
  beforeEach(async () => {
    process.env.INGEST_API_KEY = "test_ingest_key";
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
  });

  it("upserts membership tagged source='hightouch'", async () => {
    const res = await POST(
      ingestRequest({
        users: [{ external_user_id: "u-ht-1", attributes: { ht_segment_name: "vip" } }],
      }),
    );
    expect(res.status).toBe(200);

    const rows = await prisma.userSegment.findMany({ where: { externalId: "u-ht-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.segmentName).toBe("vip");
    expect(rows[0]?.source).toBe("hightouch");
  });

  it("is idempotent on re-sync (no duplicate row)", async () => {
    await POST(ingestRequest({ users: [{ external_user_id: "u-ht-1", attributes: { ht_segment_name: "vip" } }] }));
    await POST(ingestRequest({ users: [{ external_user_id: "u-ht-1", attributes: { ht_segment_name: "vip" } }] }));

    const rows = await prisma.userSegment.findMany({ where: { externalId: "u-ht-1", segmentName: "vip" } });
    expect(rows).toHaveLength(1);
  });
});
