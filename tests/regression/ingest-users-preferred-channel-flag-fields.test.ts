// Regression: Hightouch syncs the "preferred channel" boolean user-attribute
// flags using these exact column names. /api/ingest/users must accept them and
// store them verbatim on TrackedUser.attributes — no allowlist may drop them and
// no alias may rename them. This pins the contract so a future refactor of
// RESERVED_USER_KEYS / FLAT_ATTR_ALIASES / foldFlatAttributes cannot silently
// drop or rename these fields. Covers both ingest forms: the flat column-mapping
// row (top-level flags folded into attributes) and the nested-attributes Liquid
// row (attributes object passed through unchanged).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST } from "@/app/api/ingest/users/route";
import { INTERACTION_FLAGS } from "@/lib/constants/interaction-flags";

const AUTH = { Authorization: "Bearer test_ingest_key" };

// The exact field names from the Hightouch preferred-channel mapping.
const FLAG_FIELDS = [
  "guided_scripture_interaction_has_ever_flag",
  "guided_prayer_interaction_has_ever_flag",
  "audio_bible_interaction_has_ever_flag",
  "plan_audio_interaction_has_ever_flag",
  "plan_interaction_has_ever_flag",
  "plan_subscribed_has_ever_flag",
  "plan_day_completion_has_ever_flag",
  "pmt_participation_has_ever_flag",
  "votd_interaction_has_ever_flag",
  "votd_share_has_ever_flag",
] as const;

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("ingest/users preferred-channel flag fields", () => {
  it("flag list is pinned by INTERACTION_FLAGS constant", () => {
    expect(FLAG_FIELDS).toEqual([...INTERACTION_FLAGS]);
  });

  it("stores every flag verbatim from a nested-attributes (Liquid) row", async () => {
    const attributes = Object.fromEntries(FLAG_FIELDS.map((f) => [f, true]));
    const req = buildRequest("POST", { external_user_id: "usr_nested", attributes }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_nested" } });
    const stored = user?.attributes as Record<string, unknown>;
    for (const field of FLAG_FIELDS) {
      expect(stored[field]).toBe(true);
    }
  });

  it("folds every flag verbatim from a flat column-mapping row", async () => {
    // Flat row: flags sit at the top level (no nested `attributes`). foldFlatAttributes
    // must move them into attributes under the SAME key names.
    const flatRow: Record<string, unknown> = { external_user_id: "usr_flat" };
    for (const f of FLAG_FIELDS) flatRow[f] = true;

    const req = buildRequest("POST", flatRow, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_flat" } });
    const stored = user?.attributes as Record<string, unknown>;
    for (const field of FLAG_FIELDS) {
      expect(stored[field]).toBe(true);
    }
  });

  it("routes a flat flag-bearing identity row to user_sync (not push_open / events)", async () => {
    // detectKind must classify { external_user_id, ...flags } as user_sync so the
    // flags reach the attribute-folding path rather than being dropped as a
    // push-open or event row.
    const flatRow: Record<string, unknown> = { external_user_id: "usr_route", votd_share_has_ever_flag: true };
    const req = buildRequest("POST", flatRow, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_route" } });
    expect((user?.attributes as Record<string, unknown>).votd_share_has_ever_flag).toBe(true);
  });
});
