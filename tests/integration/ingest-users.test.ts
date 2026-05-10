import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createPersona } from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";

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
    expect(decision!.conversionEvent).toBe("push_open");
    expect(decision!.conversionAt).not.toBeNull();
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
      conversionEvent: "push_open", conversionAt: sentAt,  // already attributed
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
    expect(decision!.conversionEvent).toBe("push_open");
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
    expect(decision!.conversionEvent).toBe("push_open");
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
});
