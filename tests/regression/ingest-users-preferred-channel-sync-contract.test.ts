// Regression: the Hightouch "preferred channel" user-sync maps a flat column set
// onto /api/ingest/users with NO external_user_id — identity is user_id +
// braze_user_id_latest. The consumed attributes (preferred_channel_*_days,
// newsletter_*_enabled, last_seen_at) must (a) route to user_sync, (b) land on
// TrackedUser.attributes under the EXACT key names that isPushPreferred (the push
// targeting gate) and the dashboard SQL read. A rename on either the ingest side
// (RESERVED_USER_KEYS / FLAT_ATTR_ALIASES) or the consumer side would silently
// disable preferred-channel targeting with no type error. This pins the contract
// end-to-end: ingest the real sync shape, then read it back through isPushPreferred.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST } from "@/app/api/ingest/users/route";
import { isPushPreferred } from "@/lib/engine/channel-preference";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

// Mirrors the Hightouch destination-field column from the preferred-channel sync.
function syncRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // identity — note: NO external_user_id; user_id is the Nexus primary key.
    user_id: "usr_pc",
    braze_user_id_latest: "braze_pc",
    // passthrough attributes
    language_tag: "en",
    country_latest: "US",
    text_bible_version_id_latest: "111",
    source_application: "android",
    last_seen_at: "2026-06-01T12:00:00Z",
    // consumed by the cron channel-eligibility gate
    newsletter_push_enabled: true,
    newsletter_email_enabled: true,
    // consumed by isPushPreferred / dashboard — exact *_days key names
    preferred_channel_external_30_days: "push_notification",
    preferred_channel_external_90_days: "push_notification",
    preferred_channel_overall_30_days: "push_notification",
    preferred_channel_overall_90_days: "push_notification",
    // *_has_ever_flag passthrough flags (stored verbatim, nothing reads them yet)
    plan_subscribed_has_ever_flag: true,
    votd_share_has_ever_flag: true,
    ...overrides,
  };
}

describe("ingest/users preferred-channel sync contract", () => {
  it("routes the flat sync (user_id + braze_user_id_latest, no external_user_id) to user_sync", async () => {
    const res = await POST(buildRequest("POST", syncRow(), AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    // externalId = user_id, brazeId = braze_user_id_latest.
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_pc" } });
    expect(user).toBeTruthy();
    expect(user?.brazeId).toBe("braze_pc");
  });

  it("stores consumed + passthrough attributes under their exact key names", async () => {
    await POST(buildRequest("POST", syncRow(), AUTH) as NextRequest);
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_pc" } });
    const a = user?.attributes as Record<string, unknown>;

    expect(a.preferred_channel_external_30_days).toBe("push_notification");
    expect(a.preferred_channel_external_90_days).toBe("push_notification");
    expect(a.preferred_channel_overall_30_days).toBe("push_notification");
    expect(a.preferred_channel_overall_90_days).toBe("push_notification");
    expect(a.newsletter_push_enabled).toBe(true);
    expect(a.newsletter_email_enabled).toBe(true);
    expect(a.last_seen_at).toBe("2026-06-01T12:00:00Z");
    expect(a.language_tag).toBe("en");
    expect(a.country_latest).toBe("US");
    expect(a.source_application).toBe("android");
    expect(a.text_bible_version_id_latest).toBe("111");
    expect(a.plan_subscribed_has_ever_flag).toBe(true);
    expect(a.votd_share_has_ever_flag).toBe(true);
    // identity keys are NOT folded into attributes.
    expect(a.user_id).toBeUndefined();
    expect(a.braze_user_id_latest).toBeUndefined();
  });

  it("ingested preferred_channel_*_days keys are read by isPushPreferred (end-to-end name alignment)", async () => {
    // strict mode + non-active stage reads preferred_channel_external_90_days.
    await POST(buildRequest("POST", syncRow(), AUTH) as NextRequest);
    let user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_pc" } });
    expect(
      isPushPreferred(user?.attributes as Record<string, unknown>, null, "mau", "strict"),
    ).toBe(true); // 90d = push_notification → eligible

    // Flip the 90d signal to email; the same gate must now exclude.
    await POST(
      buildRequest("POST", syncRow({ preferred_channel_external_90_days: "email" }), AUTH) as NextRequest,
    );
    user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_pc" } });
    expect(
      isPushPreferred(user?.attributes as Record<string, unknown>, null, "mau", "strict"),
    ).toBe(false); // 90d = email → excluded
  });
});
