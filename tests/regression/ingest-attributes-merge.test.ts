// tests/regression/ingest-attributes-merge.test.ts
//
// REGRESSION: the user sync once wrote the attributes JSON wholesale, so a sync
// that omitted gift_* fields (e.g. the broad MAU template, which carries none)
// overwrote and DELETED gift data previously synced by the givers sync. That
// silently moved real givers into the "never-givers" segment and stripped the
// inputs the giving-handle engine reads. Ingest must MERGE incoming attributes
// over the stored ones (incoming wins per-key), never replace the whole object.

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

describe("regression: ingest merges attributes (never overwrites gift data)", () => {
  it("preserves gift_* fields when a later sync omits them", async () => {
    // 1. Givers sync: carries gift attributes.
    expect((await ingestUsers(buildRequest({
      users: [{ external_user_id: "u_merge", attributes: {
        language_tag: "en",
        gift_count_lifetime: 5,
        gift_amount_average: 40,
        gift_amount_most_recent: 25,
        gift_currency_most_recent: "USD",
      } }],
    }))).status).toBe(200);

    // 2. Broad MAU sync: same user, NO gift fields (mirrors hightouch v3 template).
    expect((await ingestUsers(buildRequest({
      users: [{ external_user_id: "u_merge", attributes: {
        language_tag: "en",
        first_name: "Dan",
      } }],
    }))).status).toBe(200);

    const user = await prisma.trackedUser.findUniqueOrThrow({ where: { externalId: "u_merge" } });
    const attrs = user.attributes as Record<string, unknown>;

    // Gift fields survive the gift-less sync...
    expect(attrs.gift_count_lifetime).toBe(5);
    expect(attrs.gift_amount_average).toBe(40);
    expect(attrs.gift_amount_most_recent).toBe(25);
    // ...and the new field from the later sync is merged in.
    expect(attrs.first_name).toBe("Dan");
    expect(attrs.language_tag).toBe("en");
  });

  it("incoming values win on key collision (fresh data overrides stale)", async () => {
    await ingestUsers(buildRequest({
      users: [{ external_user_id: "u_collide", attributes: { gift_count_lifetime: 2, language_tag: "en" } }],
    }));
    await ingestUsers(buildRequest({
      users: [{ external_user_id: "u_collide", attributes: { gift_count_lifetime: 7 } }],
    }));

    const user = await prisma.trackedUser.findUniqueOrThrow({ where: { externalId: "u_collide" } });
    const attrs = user.attributes as Record<string, unknown>;
    expect(attrs.gift_count_lifetime).toBe(7); // incoming wins
    expect(attrs.language_tag).toBe("en");      // prior key preserved
  });
});
