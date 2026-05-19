import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createPersona } from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";
import { POST as eventsPost } from "@/app/api/ingest/events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

// ── auth + basic shape ─────────────────────────────────────────────────────
describe("auth + basic shape", () => {
  it("returns 401 without auth token", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: {} });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when external_user_id is missing", async () => {
    const req = buildRequest("POST", { attributes: {} }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("creates a user on first sync", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "devotional" } }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_1" } });
    expect(user).toBeTruthy();
  });

  it("updates attributes on subsequent sync", async () => {
    await prisma.trackedUser.create({ data: { externalId: "usr_1", attributes: { plan: "old" } } });
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "new" } }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_1" } });
    expect((user?.attributes as Record<string, string>).plan).toBe("new");
  });

  it("handles batch upsert and deduplication", async () => {
    const req = buildRequest("POST", {
      users: [
        { external_user_id: "usr_1", attributes: {} },
        { external_user_id: "usr_2", attributes: {} },
        { external_user_id: "usr_1", attributes: {} }, // duplicate
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.received).toBe(2);     // after dedup
    expect(body.deduplicated).toBe(1); // one dupe
    expect(body.upserted).toBe(2);

    const count = await prisma.trackedUser.count();
    expect(count).toBe(2);
  });
});

// ── batch formats ──────────────────────────────────────────────────────────
describe("batch formats", () => {
  it("accepts top-level array format", async () => {
    const req = buildRequest("POST", [
      { external_user_id: "usr_arr_1", attributes: {} },
      { external_user_id: "usr_arr_2", attributes: {} },
    ], AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(2);

    const count = await prisma.trackedUser.count();
    expect(count).toBe(2);
  });

  it("skips anonymous users (no external_user_id, no braze_id) silently", async () => {
    const req = buildRequest("POST", {
      users: [
        { attributes: { plan: "devotional" } }, // no external_user_id, no braze_id — anonymous
        { external_user_id: "usr_named", attributes: {} },
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);
    expect(body.skipped_anonymous).toBe(1);
  });

  it("returns early with upserted=0 when all users are anonymous", async () => {
    const req = buildRequest("POST", {
      users: [{ attributes: {} }],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(0);
    expect(body.skipped_anonymous).toBe(1);

    const count = await prisma.trackedUser.count();
    expect(count).toBe(0);
  });
});

// ── braze_id targeting (unverified users) ──────────────────────────────────
describe("braze_id targeting", () => {
  it("creates an unverified user using braze_id as externalId", async () => {
    const req = buildRequest("POST", {
      braze_id: "braze-abc-123",
      funnel_stage: "lapsed",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "braze-abc-123" } });
    expect(user).toBeTruthy();
    expect(user!.brazeId).toBe("braze-abc-123");
  });

  it("stores brazeId on a verified user who provides both identifiers", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_verified",
      braze_id: "braze-xyz-456",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_verified" } });
    expect(user!.brazeId).toBe("braze-xyz-456");
  });

  it("does not overwrite an existing brazeId when braze_id is absent on re-sync", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "usr_keepbraze", brazeId: "braze-keep-me", attributes: {} },
    });
    const req = buildRequest("POST", {
      external_user_id: "usr_keepbraze",
      attributes: { plan: "devotional" },
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_keepbraze" } });
    expect(user!.brazeId).toBe("braze-keep-me");
  });

  it("handles batch with mixed verified and unverified users", async () => {
    const req = buildRequest("POST", {
      users: [
        { external_user_id: "usr_verified_2", braze_id: "braze-v2", attributes: {} },
        { braze_id: "braze-unverified", attributes: {} },
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(2);

    const verified = await prisma.trackedUser.findUnique({ where: { externalId: "usr_verified_2" } });
    expect(verified!.brazeId).toBe("braze-v2");

    const unverified = await prisma.trackedUser.findUnique({ where: { externalId: "braze-unverified" } });
    expect(unverified!.brazeId).toBe("braze-unverified");
  });

  it("treats empty-string external_user_id as absent and uses braze_id", async () => {
    const req = buildRequest("POST", {
      external_user_id: "",
      braze_id: "braze-empty-ext",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "braze-empty-ext" } });
    expect(user).toBeTruthy();
    expect(user!.brazeId).toBe("braze-empty-ext");
  });
});

// ── last_seen_at → preferred send time ────────────────────────────────────
describe("last_seen_at → preferred send time", () => {
  it("stores preferredSendHour and preferredSendMinute from last_seen_at UTC time", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_seen",
      attributes: { last_seen_at: "2026-05-08T14:37:00Z" },
    }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_seen" } });
    expect(user!.preferredSendHour).toBe(14);
    expect(user!.preferredSendMinute).toBe(37);
  });

  it("does not set preferred send time when last_seen_at is absent", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_no_seen",
      attributes: { plan: "devotional" },
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_no_seen" } });
    expect(user!.preferredSendHour).toBeNull();
    expect(user!.preferredSendMinute).toBeNull();
  });

  it("overwrites stale preferred send time on re-sync", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "usr_resync", preferredSendHour: 10, preferredSendMinute: 0 },
    });

    const req = buildRequest("POST", {
      external_user_id: "usr_resync",
      attributes: { last_seen_at: "2026-05-08T20:15:00Z" },
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_resync" } });
    expect(user!.preferredSendHour).toBe(20);
    expect(user!.preferredSendMinute).toBe(15);
  });
});

// ── funnel_stage + persona assignment ─────────────────────────────────────
describe("funnel_stage + persona assignment", () => {
  it("assigns Re-engager persona for funnel_stage: lapsed", async () => {
    const reEngager = await createPersona({ name: "Re-engager", label: "Re-engager" });

    const req = buildRequest("POST", {
      external_user_id: "usr_lapsed",
      funnel_stage: "lapsed",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persona_assigned).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_lapsed" } });
    expect(user!.personaId).toBe(reEngager.id);
  });

  it("assigns Re-engager persona for funnel_stage: lapsed_mau", async () => {
    const reEngager = await createPersona({ name: "Re-engager", label: "Re-engager" });

    const req = buildRequest("POST", {
      external_user_id: "usr_lapsed_mau",
      funnel_stage: "lapsed_mau",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.persona_assigned).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_lapsed_mau" } });
    expect(user!.personaId).toBe(reEngager.id);
  });

  it("stores funnel_stage on the user record", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_funnel",
      funnel_stage: "core",
      attributes: {},
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_funnel" } });
    expect(user!.funnelStage).toBe("core");
  });

  it("stamps funnelStageUpdatedAt when funnel_stage is provided", async () => {
    const before = new Date();
    const req = buildRequest("POST", {
      external_user_id: "usr_stamp",
      funnel_stage: "lapsed",
      attributes: {},
    }, AUTH);
    await POST(req as NextRequest);
    const after = new Date();

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_stamp" } });
    expect(user!.funnelStageUpdatedAt).not.toBeNull();
    expect(user!.funnelStageUpdatedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(user!.funnelStageUpdatedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("does not set funnelStageUpdatedAt when funnel_stage is absent", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_no_stage",
      attributes: {},
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_no_stage" } });
    expect(user!.funnelStageUpdatedAt).toBeNull();
  });

  it("updates funnel_stage on re-sync", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "usr_funnel_upd", funnelStage: "lapsed" },
    });

    const req = buildRequest("POST", {
      external_user_id: "usr_funnel_upd",
      funnel_stage: "core",
      attributes: {},
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_funnel_upd" } });
    expect(user!.funnelStage).toBe("core");
  });

  it("falls back to Bible-first persona when classifier returns null", async () => {
    const biblePer = await createPersona({ name: "Bible-first", label: "Bible-first" });

    // Attributes produce no strong classifier signal → classifyPersona returns null → "Bible-first" fallback
    const req = buildRequest("POST", {
      external_user_id: "usr_fallback",
      funnel_stage: "connected",
      attributes: { plan_finish_lifetime_count: 1 },
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.persona_assigned).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_fallback" } });
    expect(user!.personaId).toBe(biblePer.id);
  });

  it("counts all assigned personas in persona_assigned field", async () => {
    await createPersona({ name: "Re-engager", label: "Re-engager" });

    const req = buildRequest("POST", {
      users: [
        { external_user_id: "usr_pa_1", funnel_stage: "lapsed", attributes: {} },
        { external_user_id: "usr_pa_2", funnel_stage: "lapsed_mau", attributes: {} },
        { external_user_id: "usr_pa_3", funnel_stage: "core", attributes: {} }, // no matching persona
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.upserted).toBe(3);
    expect(body.persona_assigned).toBe(2); // only the two lapsed users
  });
});

// ── response shape ─────────────────────────────────────────────────────────
describe("response shape", () => {
  it("includes all expected fields in the response", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_resp",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body).toHaveProperty("ok", true);
    expect(body).toHaveProperty("received");
    expect(body).toHaveProperty("deduplicated");
    expect(body).toHaveProperty("skipped_anonymous");
    expect(body).toHaveProperty("upserted");
    expect(body).toHaveProperty("persona_assigned");
  });
});

// ── push open events ────────────────────────────────────────────────────────
import {
  createAgent,
  createMessage,
  createVariant,
  createUser,
  createUserDecision,
  linkAgentToPersona,
} from "../helpers/builders";

describe("push open events: { events: [...] } format", () => {
  it("attributes a push_open to the matching UserDecision and sets conversionEvent", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_open" });
    const variant  = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_open_1", { personaId: persona.id });

    // UserDecision sent 2h ago — within 48h attribution window
    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const occurredAt = new Date().toISOString();
    const payload = {
      events: [{
        event_id: "braze_abc:2026-05-10T15:00:00Z",
        event_name: "push_open",
        external_user_id: user.externalId,
        occurred_at: occurredAt,
        properties: { campaign_id: "camp_open" },
      }],
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(1);
    expect(body.unmatched).toBe(0);

    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.pushOpenAt).not.toBeNull();      // push open recorded
    expect(decision!.conversionEvent).toBeNull();     // slot preserved for goal event
    expect(decision!.conversionAt).toBeNull();        // slot preserved for goal event
  });

  it("does not match a decision that is already attributed", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_open_2", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({
      agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id,
      pushOpenAt: sentAt,  // already push-opened — pushOpenAt: null check will exclude it
    });

    const payload = {
      events: [{
        event_id: "braze_abc:already",
        event_name: "push_open",
        external_user_id: user.externalId,
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(0);
    expect(body.unmatched).toBe(1);
  });

  it("returns unmatched=1 when no decision exists within the attribution window", async () => {
    await createUser("usr_open_3");

    const payload = {
      events: [{
        event_id: "braze_xyz:no_decision",
        event_name: "push_open",
        external_user_id: "usr_open_3",
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(0);
    expect(body.unmatched).toBe(1);
  });
});

describe("push open events: flat column-mapping rows", () => {
  it("attributes a push_open from a flat { user_id, event_timestamp } row", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_flat" });
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_flat_1", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      user_id: user.externalId,
      braze_user_id: "braze_flat_1",
      campaign_id: "camp_flat",
      event_timestamp: new Date().toISOString(),
      timezone: "America/New_York",
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(1);

    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.pushOpenAt).not.toBeNull();
    expect(decision!.conversionEvent).toBeNull();
  });

  it("handles unverified user (no user_id) using braze_user_id as externalId", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    // Unverified user: externalId === brazeId
    const brazeId = "braze_unverified_1";
    await createUser(brazeId, { personaId: persona.id, brazeId });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: brazeId, sentAt, messageVariantId: variant.id });

    const payload = {
      user_id: "",        // empty — unverified
      braze_user_id: brazeId,
      campaign_id: "camp_unverified",
      event_timestamp: new Date().toISOString(),
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(1);

    const decision = await prisma.userDecision.findFirst({ where: { userId: brazeId } });
    expect(decision!.pushOpenAt).not.toBeNull();
    expect(decision!.conversionEvent).toBeNull();
  });

  it("accepts Hightouch audience sync flat row (braze_user_id_latest + 'User Last Seen')", async () => {
    // Regression: Hightouch "Push Opens - Audiences" sync without Liquid template sends
    // braze_user_id_latest and "User Last Seen" instead of braze_user_id + event_timestamp.
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const brazeId = "braze_ht_audience_1";
    await createUser(brazeId, { personaId: persona.id, brazeId });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: brazeId, sentAt, messageVariantId: variant.id });

    const payload = {
      braze_user_id_latest: brazeId,
      user_id: null,
      "User Last Seen": new Date().toISOString(),
      last_updated_timestamp: null,
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(1);

    const decision = await prisma.userDecision.findFirst({ where: { userId: brazeId } });
    expect(decision!.pushOpenAt).not.toBeNull();
    expect(decision!.conversionEvent).toBeNull();
  });

  it("deduplicates batch push open rows with the same event_id", async () => {
    await createUser("usr_dedup_open");

    const row = {
      user_id: "usr_dedup_open",
      braze_user_id: "braze_dedup",
      campaign_id: "camp_dedup",
      event_timestamp: "2026-05-10T15:00:00Z",
    };

    const res  = await POST(buildRequest("POST", [row, row], AUTH) as NextRequest);
    const body = await res.json();
    // Both rows produce the same event_id — second is deduplicated
    expect(body.received).toBe(1);
    expect(body.deduplicated).toBe(1);
  });

  it("accepts canvas-level fields from Hightouch push opens sync without error", async () => {
    // Regression guard: canvas_id, canvas_step_id, canvas_variation_id,
    // canvas_step_message_variation_id, app_group_id, app_id added in Hightouch
    // push opens sync (sync ID 2765748) — endpoint must not reject them.
    await createUser("usr_canvas_fields");

    const row = {
      user_id: "usr_canvas_fields",
      braze_user_id: "braze_canvas_1",
      campaign_id: "camp_canvas",
      event_timestamp: new Date().toISOString(),
      canvas_id: "canvas-abc-123",
      canvas_step_id: "step-def-456",
      canvas_variation_id: "var-ghi-789",
      canvas_step_message_variation_id: "msgvar-jkl-012",
      app_group_id: "appgroup-mno-345",
      app_id: "app-pqr-678",
    };

    const res  = await POST(buildRequest("POST", row, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // No matching decision exists — unmatched=1 is correct; the key assertion is no 400/500
    expect(body.unmatched).toBe(1);
  });
});

// ── improvement: pushOpenAt vs conversionAt ────────────────────────────────
describe("push_open uses pushOpenAt — conversionAt slot stays open", () => {
  it("stamps pushOpenAt without setting conversionAt", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_pushopen_slot", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      events: [{
        event_id: "slot_test:001",
        event_name: "push_open",
        external_user_id: user.externalId,
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    };
    await POST(buildRequest("POST", payload, AUTH) as NextRequest);

    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.pushOpenAt).not.toBeNull();  // push open recorded
    expect(decision!.conversionAt).toBeNull();    // slot still open for a goal event
    expect(decision!.conversionEvent).toBeNull(); // no conversion yet
  });

  it("allows a goal event to attribute after a push_open on the same decision", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await prisma.goal.create({
      data: { agentId: agent.id, eventName: "plan_started", tier: "best", valueWeight: 1.0, weightMode: "fixed", weightDefault: 1.0 },
    });
    const user = await createUser("usr_pushopen_then_goal", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    // Step 1: push_open arrives (from Hightouch batch)
    await POST(buildRequest("POST", {
      events: [{
        event_id: "chain_test:push_open",
        event_name: "push_open",
        external_user_id: user.externalId,
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    }, AUTH) as NextRequest);

    // Step 2: plan_started arrives (real-time) — should still claim the slot
    await eventsPost(buildRequest("POST", {
      events: [{
        event_id: "chain_test:plan_started",
        event_name: "plan_started",
        external_user_id: user.externalId,
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    }, AUTH) as NextRequest);

    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.pushOpenAt).not.toBeNull();       // push open recorded
    expect(decision!.conversionEvent).toBe("plan_started"); // goal attributed
    expect(decision!.conversionAt).not.toBeNull();          // slot claimed by goal
  });
});

// ── improvement: cross-batch idempotency ──────────────────────────────────
describe("cross-batch idempotency via ProcessedEventId", () => {
  it("does not re-attribute when the same event_id is sent in a second request", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_idem", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      events: [{
        event_id: "idem_test:001",
        event_name: "push_open",
        external_user_id: user.externalId,
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    };

    // First request — should match
    const res1  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body1 = await res1.json();
    expect(body1.matched).toBe(1);

    // Second request (Hightouch retry) — same event_id, should be a no-op
    const res2  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.matched).toBe(0);
    expect(body2.unmatched).toBe(1); // counted as unmatched (already processed)

    // DB should only have one pushOpenAt, not double-stamped
    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.pushOpenAt).not.toBeNull();
  });
});

// ── improvement: IngestSyncLog written on every sync ─────────────────────
describe("IngestSyncLog", () => {
  it("writes a user_sync log row after a user sync", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_log", attributes: {} }, AUTH);
    await POST(req as NextRequest);

    const log = await prisma.ingestSyncLog.findFirst({ where: { syncKind: "user_sync" } });
    expect(log).not.toBeNull();
    expect(log!.received).toBe(1);
    expect(log!.upserted).toBe(1);
  });

  it("writes a push_open_events log row after event attribution", async () => {
    await createUser("usr_log_events");

    const payload = {
      events: [{
        event_id: "log_test:001",
        event_name: "push_open",
        external_user_id: "usr_log_events",
        occurred_at: new Date().toISOString(),
        properties: {},
      }],
    };
    await POST(buildRequest("POST", payload, AUTH) as NextRequest);

    const log = await prisma.ingestSyncLog.findFirst({ where: { syncKind: "push_open_events" } });
    expect(log).not.toBeNull();
    expect(log!.matched).toBeDefined();
    expect(log!.unmatched).toBeDefined();
  });
});

// ── flat HT user sync rows (Lapsed Habitual DAU4 style) ───────────────────
describe("flat Hightouch user sync rows", () => {
  it("upserts a user from a flat braze_user_id_latest row (no last_updated_timestamp)", async () => {
    // Hightouch 'Lapsed Habitual DAU4' sends column-mapped fields without a Liquid template.
    // These rows have braze_user_id_latest but NO last_updated_timestamp (which distinguishes
    // them from push open rows that DO have last_updated_timestamp).
    const payload = {
      braze_user_id_latest: "braze_abc123",
      user_id: "usr_flat_1",
      language_tag: "en",
      plan_locale_latest: "en-US",
      newsletter_push_enabled: true,
      newsletter_email_enabled: false,
      "User Last Seen": new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_flat_1" } });
    expect(user).not.toBeNull();
    expect(user!.brazeId).toBe("braze_abc123");
    const attrs = user!.attributes as Record<string, unknown>;
    expect(attrs.language_tag).toBe("en");
    expect(attrs.plan_locale).toBe("en-US");
    expect(attrs.newsletter_push_enabled).toBe(true);
    expect(attrs.newsletter_email_enabled).toBe(false);
    expect(attrs.last_seen_at).toBeTruthy();
    // preferredSendHour should be derived from User Last Seen
    expect(user!.preferredSendHour).toBeGreaterThanOrEqual(0);
  });

  it("uses last_seen_timestamp from flat Hightouch user sync rows", async () => {
    const lastSeen = "2026-05-13T15:42:00.000Z";
    const payload = {
      braze_user_id_latest: "braze_last_seen_timestamp",
      user_id: "usr_last_seen_timestamp",
      last_seen_timestamp: lastSeen,
      language_tag: "en",
      newsletter_push_enabled: true,
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_last_seen_timestamp" } });
    expect(user).not.toBeNull();
    const attrs = user!.attributes as Record<string, unknown>;
    expect(attrs.last_seen_at).toBe(lastSeen);
    expect(user!.preferredSendHour).toBe(15);
    expect(user!.preferredSendMinute).toBe(42);
  });

  it("normalizes braze_user_id_latest inside a wrapped users batch", async () => {
    const payload = {
      users: [
        {
          braze_user_id_latest: "braze_wrapped_latest",
          last_seen_timestamp: "2026-05-13T16:30:00.000Z",
          language_tag: "en",
          newsletter_push_enabled: true,
        },
      ],
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "braze_wrapped_latest" } });
    expect(user).not.toBeNull();
    expect(user!.brazeId).toBe("braze_wrapped_latest");
    const attrs = user!.attributes as Record<string, unknown>;
    expect(attrs.last_seen_at).toBe("2026-05-13T16:30:00.000Z");
    expect(attrs.language_tag).toBe("en");
    expect(attrs.newsletter_push_enabled).toBe(true);
  });

  it("does NOT treat the flat user sync row as a push_open_rows (matched=0, unmatched=1 regression)", async () => {
    // Regression: before the fix, braze_user_id_latest caused detectKind to return
    // push_open_rows regardless of other fields, causing matched:0, unmatched:1.
    const payload = {
      braze_user_id_latest: "braze_xyz789",
      user_id: "usr_flat_2",
      "User Last Seen": new Date().toISOString(),
      newsletter_push_enabled: false,
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();

    // Should be processed as a user sync, not push_open_rows
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);
    // user_sync responses have no matched/unmatched fields
    expect(body.matched).toBeUndefined();
    expect(body.unmatched).toBeUndefined();
  });

  it("promotes unverified braze-only record when verified user arrives with same braze_id (500 regression)", async () => {
    // Regression: user first ingested as unverified (externalId = brazeId = "braze_promote_test").
    // Later arrives verified with real external_user_id. The unique constraint on brazeId caused
    // a 500 because the old record already held that brazeId value.
    await prisma.trackedUser.create({
      data: {
        externalId: "braze_promote_test",
        brazeId: "braze_promote_test",
        attributes: { language_tag: "en" },
      },
    });

    const payload = {
      users: [
        {
          external_user_id: "verified_user_789",
          braze_id: "braze_promote_test",
          funnel_stage: "lapsed_wau",
          attributes: { language_tag: "en" },
        },
      ],
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    // Old unverified record should be gone, replaced by the real externalId
    const oldRecord = await prisma.trackedUser.findUnique({ where: { externalId: "braze_promote_test" } });
    expect(oldRecord).toBeNull();

    const newRecord = await prisma.trackedUser.findUnique({ where: { externalId: "verified_user_789" } });
    expect(newRecord).not.toBeNull();
    expect(newRecord!.brazeId).toBe("braze_promote_test");
  });

  it("still treats rows WITH last_updated_timestamp as push open rows", async () => {
    // Rows with last_updated_timestamp are push open events, not user sync.
    const payload = {
      braze_user_id_latest: "braze_push_open",
      user_id: "usr_push_open_test",
      last_updated_timestamp: new Date().toISOString(),
      "User Last Seen": new Date().toISOString(),
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();

    // Treated as push_open_rows — no user upserted
    expect(res.status).toBe(200);
    expect(body.upserted).toBeUndefined();
    expect(body.matched).toBeDefined();
    expect(body.unmatched).toBeDefined();
  });
});

// ── Canvas exact attribution ───────────────────────────────────────────────────
// When canvas_step_id is present and maps to a known MessageVariant, the open
// is exactly attributed to that arm and arm stats are updated immediately.

describe("canvas exact attribution via canvas_step_id", () => {
  it("credits arm stats when canvas_step_id matches a known variant (passive learning)", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id);
    const variant  = await createVariant(msg.id, { brazeCanvasStepId: "step-abc-123" });
    await linkAgentToPersona(agent.id, persona.id);
    const user     = await createUser("usr_canvas_attr_1", { personaId: persona.id });

    // Push open arrives with canvas_step_id — no prior UserDecision (passive send)
    const payload = {
      user_id:         user.externalId,
      braze_user_id:   "braze_canvas_attr_1",
      event_timestamp: new Date().toISOString(),
      canvas_id:       "canvas-xyz",
      canvas_step_id:  "step-abc-123",
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(1);

    // Synthetic UserDecision created
    const decision = await prisma.userDecision.findFirst({
      where: { userId: user.externalId, messageVariantId: variant.id },
    });
    expect(decision).not.toBeNull();
    expect(decision!.pushOpenAt).not.toBeNull();
    expect((decision!.decisionContext as Record<string, unknown>)?.source).toBe("canvas_observed");

    // Arm stats updated for this variant
    const armStats = await prisma.personaArmStats.findFirst({
      where: { personaId: persona.id, agentId: agent.id, variantId: variant.id },
    });
    expect(armStats).not.toBeNull();
    expect(armStats!.wins).toBe(1);
    expect(armStats!.alpha).toBeGreaterThan(1);
  });

  it("stamps pushOpenAt on an existing Nexus-controlled decision when canvas_step_id matches", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id);
    const variant  = await createVariant(msg.id, { brazeCanvasStepId: "step-nexus-123" });
    await linkAgentToPersona(agent.id, persona.id);
    const user     = await createUser("usr_canvas_attr_2", { personaId: persona.id });

    // Nexus already sent this variant — UserDecision exists
    const sentAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      user_id:         user.externalId,
      braze_user_id:   "braze_nexus_canvas",
      event_timestamp: new Date().toISOString(),
      canvas_step_id:  "step-nexus-123",
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(1);

    // Original decision stamped — no synthetic created
    const decisions = await prisma.userDecision.findMany({
      where: { userId: user.externalId, agentId: agent.id },
    });
    expect(decisions).toHaveLength(1); // only the original
    expect(decisions[0].pushOpenAt).not.toBeNull();
  });

  it("falls through to time-window attribution when canvas_step_id has no matching variant", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id);
    const variant  = await createVariant(msg.id); // no brazeCanvasStepId
    await linkAgentToPersona(agent.id, persona.id);
    const user     = await createUser("usr_canvas_attr_3", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 30 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      user_id:         user.externalId,
      braze_user_id:   "braze_canvas_fallback",
      event_timestamp: new Date().toISOString(),
      canvas_step_id:  "step-unknown-999", // no variant has this ID
    };

    const res  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    // Falls through to time-window match — still finds the UserDecision
    expect(body.matched).toBe(1);
    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.pushOpenAt).not.toBeNull();
  });

  it("is idempotent — second send of same event_id is a no-op", async () => {
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id, { brazeCanvasStepId: "step-idem-456" });
    await createUser("usr_canvas_idem");

    const payload = {
      push_notification_event_id: "idem-canvas-evt-001",
      user_id:                    "usr_canvas_idem",
      event_timestamp:            new Date().toISOString(),
      canvas_step_id:             "step-idem-456",
    };

    await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const res2  = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body2 = await res2.json();

    // Second call: already processed → unmatched (idempotency key blocks re-processing)
    expect(body2.matched + body2.unmatched).toBe(1);
    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_canvas_idem" } });
    expect(decisions).toHaveLength(1); // only one synthetic decision
  });
});
