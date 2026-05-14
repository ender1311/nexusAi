import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createMessage, createVariant,
  createUser, createPersona, createUserDecision, linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/braze-events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/ingest/braze-events — auth", () => {
  it("returns 401 without auth", async () => {
    const res = await POST(buildRequest("POST", { events: [] }) as NextRequest);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ingest/braze-events — click rewards", () => {
  it("rewards a matched decision and updates both PersonaArmStats and UserArmStats", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { brazeVariantId: "bv_1" });
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_braze_click_1", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    await createUserDecision({
      agentId: agent.id, userId: user.externalId,
      messageVariantId: variant.id, channel: "push", sentAt,
    });

    const payload = {
      events: [{
        id: "braze-evt-001",
        event_type: "users.messages.pushnotification.Open",
        user: { user_id: user.externalId },
        properties: { message_variation_id: variant.brazeVariantId },
      }],
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(1);
    expect(body.rewarded).toBe(1);

    // Decision updated with click reward
    const decision = await prisma.userDecision.findFirst({ where: { userId: user.externalId } });
    expect(decision!.reward).toBe(0.8);
    expect(decision!.conversionAt).not.toBeNull();
    expect(decision!.brazeAnalyticsFetchedAt).not.toBeNull(); // blocks analytics cron

    // PersonaArmStats updated
    const personaStats = await prisma.personaArmStats.findFirst({
      where: { personaId: persona.id, agentId: agent.id, variantId: variant.id },
    });
    expect(personaStats).not.toBeNull();
    expect(personaStats!.wins).toBe(1);
    expect(personaStats!.alpha).toBeGreaterThan(1);

    // UserArmStats updated (regression: was missing before)
    const userStats = await prisma.userArmStats.findFirst({
      where: { userId: user.externalId, agentId: agent.id, variantId: variant.id },
    });
    expect(userStats).not.toBeNull();
    expect(userStats!.wins).toBe(1);
    expect(userStats!.alpha).toBeGreaterThan(1);
  });

  it("is idempotent — same Braze event id processed twice only rewards once", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_braze_idem", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 30 * 60 * 1000);
    await createUserDecision({
      agentId: agent.id, userId: user.externalId,
      messageVariantId: variant.id, channel: "push", sentAt,
    });
    // Second decision — retry must not attribute to this one
    await createUserDecision({
      agentId: agent.id, userId: user.externalId,
      messageVariantId: variant.id, channel: "push", sentAt,
    });

    const payload = {
      events: [{
        id: "braze-idem-evt-001",
        event_type: "users.messages.pushnotification.Open",
        user: { user_id: user.externalId },
        properties: {},
      }],
    };

    const res1 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body1 = await res1.json();
    expect(body1.rewarded).toBe(1);

    // Retry with same event id — must be a no-op
    const res2 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.rewarded).toBe(0);

    // Only one decision should have been rewarded
    const rewarded = await prisma.userDecision.count({
      where: { userId: user.externalId, reward: { not: null } },
    });
    expect(rewarded).toBe(1);
  });

  it("non-click events (email Open) return ok with matched=0", async () => {
    const payload = {
      events: [{
        id: "braze-open-evt-001",
        event_type: "users.messages.email.Open",
        user: { user_id: "usr_email_open" },
        properties: {},
      }],
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(0);
  });
});
