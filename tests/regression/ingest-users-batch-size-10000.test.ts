import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST } from "@/app/api/ingest/users/route";

// Regression: Hightouch user-audience syncs ship up to 10,000 rows in a single
// POST. The user-sync batch cap was raised 1000 → 10000, and the per-user
// identity-resolution findUniques were batched per chunk so the larger payload
// still resolves within the function timeout. Guards both the new ceiling and
// that batches over the OLD 1000 limit are now accepted and fully upserted.

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("ingest/users batch size cap (10000)", () => {
  it("rejects a batch larger than 10000 users with 400", async () => {
    const users = Array.from({ length: 10001 }, (_, i) => ({
      external_user_id: `usr_${i}`,
      attributes: {},
    }));
    const req = buildRequest("POST", { users }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("10000");
  });

  it("accepts a batch over the old 1000 limit (no 'too large' rejection)", async () => {
    // Prove the cap moved past 1000 without paying for 1000 real upserts: the
    // size check runs before the anonymous-filter early-return, so a 1001-row
    // batch that's mostly anonymous flows past the old limit and only upserts
    // the few identified rows. The chunked upsert path itself is covered by the
    // existing ingest-users batch/identity-resolution integration tests.
    const IDENTIFIED = 5;
    const TOTAL = 1001;
    const users = [
      ...Array.from({ length: IDENTIFIED }, (_, i) => ({
        external_user_id: `usr_${i}`,
        attributes: { language_tag: "en" },
      })),
      ...Array.from({ length: TOTAL - IDENTIFIED }, () => ({ attributes: {} })), // anonymous
    ];
    const req = buildRequest("POST", { users }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.upserted).toBe(IDENTIFIED);
    expect(body.skipped_anonymous).toBe(TOTAL - IDENTIFIED);

    const count = await prisma.trackedUser.count();
    expect(count).toBe(IDENTIFIED);
  });
});
