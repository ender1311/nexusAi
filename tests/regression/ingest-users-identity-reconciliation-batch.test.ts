// tests/regression/ingest-users-identity-reconciliation-batch.test.ts
//
// REGRESSION (C3): the identity re-key/delete reconciliation used to run inside
// the parallel `Promise.all(chunk.map(...))` user-upsert loop. Those ops are
// destructive (re-key an unverified record's externalId, or delete a stale
// duplicate) and multiple users in one chunk can target overlapping records, so
// running them concurrently was a race. They now run in a sequential pre-pass
// before the parallel map. This test puts several reconciliation cases in a
// SINGLE batch (one chunk) and asserts every one resolves to the correct final
// state — it fails if the ops are moved back into the concurrent map and a race
// corrupts the outcome.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { POST as ingestUsers } from "@/app/api/ingest/users/route";
import { NextRequest } from "next/server";

const AUTH = { Authorization: "Bearer test_ingest_key" };

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/ingest/users", {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("regression: identity reconciliation runs correctly for a whole batch", () => {
  it("promotes two unverified records and rejects one conflicting braze_id in one sync", async () => {
    // Two stale unverified records (externalId == brazeId), each to be promoted.
    await prisma.trackedUser.create({
      data: { externalId: "braze_promote_a", brazeId: "braze_promote_a", attributes: { language_tag: "en" } },
    });
    await prisma.trackedUser.create({
      data: { externalId: "braze_promote_b", brazeId: "braze_promote_b", attributes: { language_tag: "en" } },
    });
    // A verified record already owning a braze_id a third incoming user will collide with.
    await prisma.trackedUser.create({
      data: { externalId: "owner_verified", brazeId: "braze_taken", attributes: { language_tag: "en" } },
    });

    const res = await ingestUsers(buildRequest({
      users: [
        { external_user_id: "verified_a", braze_id: "braze_promote_a", attributes: { language_tag: "en" } },
        { external_user_id: "verified_b", braze_id: "braze_promote_b", attributes: { language_tag: "en" } },
        { external_user_id: "incoming_conflict", braze_id: "braze_taken", attributes: { language_tag: "en" } },
      ],
    }));
    expect(res.status).toBe(200);

    // Both promotions: old unverified rows gone, new verified rows hold the braze_id.
    expect(await prisma.trackedUser.findUnique({ where: { externalId: "braze_promote_a" } })).toBeNull();
    expect(await prisma.trackedUser.findUnique({ where: { externalId: "braze_promote_b" } })).toBeNull();
    const a = await prisma.trackedUser.findUnique({ where: { externalId: "verified_a" } });
    const b = await prisma.trackedUser.findUnique({ where: { externalId: "verified_b" } });
    expect(a!.brazeId).toBe("braze_promote_a");
    expect(b!.brazeId).toBe("braze_promote_b");

    // Conflict: incoming user is stored without the already-owned braze_id; owner untouched.
    const owner = await prisma.trackedUser.findUnique({ where: { externalId: "owner_verified" } });
    expect(owner!.brazeId).toBe("braze_taken");
    const incoming = await prisma.trackedUser.findUnique({ where: { externalId: "incoming_conflict" } });
    expect(incoming!.brazeId).toBeNull();
  });
});
