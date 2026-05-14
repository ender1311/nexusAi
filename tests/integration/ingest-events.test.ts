import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createGoal, createMessage, createVariant,
  createUser, createPersona, createUserDecision, linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/ingest/events", () => {
  it("returns 401 without auth", async () => {
    const req = buildRequest("POST", {
      event_id: "e1", event_name: "plan_started",
      external_user_id: "usr_1", occurred_at: new Date().toISOString(),
    });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    const req = buildRequest("POST", { event_name: "plan_started" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("matches event to UserDecision within 48h window and records reward", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    await createUserDecision({ agentId: agent.id, userId: "usr_1", messageVariantId: variant.id, channel: "push", sentAt });

    const req = buildRequest("POST", {
      event_id: "e1", event_name: "plan_started",
      external_user_id: "usr_1", occurred_at: new Date().toISOString(),
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(1);
    expect(body.unmatched).toBe(0);

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr_1" } });
    expect(decision?.conversionEvent).toBe("plan_started");
    expect(decision?.reward).not.toBeNull();
  });

  it("does NOT match event outside 48h window", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    // sentAt 49 hours ago — outside window
    const sentAt = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: "usr_1", messageVariantId: variant.id, sentAt });

    const req = buildRequest("POST", {
      event_id: "e2", event_name: "plan_started",
      external_user_id: "usr_1", occurred_at: new Date().toISOString(),
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.unmatched).toBe(1);
    expect(body.matched).toBe(0);
  });

  it("updates PersonaArmStats after conversion — WILL FAIL until Task 15", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const user = await createUser("usr_2", { personaId: persona.id });
    const sentAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, messageVariantId: variant.id, sentAt });

    const req = buildRequest("POST", {
      event_id: "e3", event_name: "plan_started",
      external_user_id: "usr_2", occurred_at: new Date().toISOString(),
    }, AUTH);
    await POST(req as NextRequest);

    const armStats = await prisma.personaArmStats.findUnique({
      where: {
        personaId_agentId_variantId: {
          personaId: persona.id,
          agentId: agent.id,
          variantId: variant.id,
        },
      },
    });
    // This assertion FAILS until PersonaArmStats update is added to the route
    expect(armStats).not.toBeNull();
    expect(armStats?.tries).toBe(1);
    expect(armStats?.wins).toBe(1);
  });
});

// ── cross-request idempotency ──────────────────────────────────────────────
describe("cross-request idempotency via ProcessedEventId", () => {
  it("does not re-attribute a goal event sent in two separate requests", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_idem_conv");
    const sentAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: "usr_idem_conv", messageVariantId: variant.id, sentAt });
    // Create a second decision — retry should NOT attribute to this one either
    await createUserDecision({ agentId: agent.id, userId: "usr_idem_conv", messageVariantId: variant.id, sentAt });

    const payload = {
      event_id: "idem_goal_001",
      event_name: "plan_started",
      external_user_id: "usr_idem_conv",
      occurred_at: new Date().toISOString(),
    };

    const res1 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body1 = await res1.json();
    expect(body1.matched).toBe(1);

    // Retry with same event_id — must be a complete no-op
    const res2 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.matched).toBe(0);
    expect(body2.unmatched).toBe(1);

    // Only one decision should have conversionAt set
    const attributed = await prisma.userDecision.count({
      where: { userId: "usr_idem_conv", conversionAt: { not: null } },
    });
    expect(attributed).toBe(1);
  });
});

// ── push_disabled event ───────────────────────────────────────────────────
describe("push_disabled event", () => {
  it("updates both PersonaArmStats and UserArmStats on push_disabled", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_optout_1", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, messageVariantId: variant.id, sentAt });

    await POST(buildRequest("POST", {
      event_id: "optout_001",
      event_name: "push_disabled",
      external_user_id: user.externalId,
      occurred_at: new Date().toISOString(),
    }, AUTH) as NextRequest);

    const personaStats = await prisma.personaArmStats.findFirst({
      where: { personaId: persona.id, agentId: agent.id, variantId: variant.id },
    });
    expect(personaStats?.beta).toBeGreaterThan(1); // penalty applied

    const userStats = await prisma.userArmStats.findFirst({
      where: { userId: user.externalId, agentId: agent.id, variantId: variant.id },
    });
    expect(userStats).not.toBeNull();
    expect(userStats?.beta).toBeGreaterThan(1); // penalty applied per-user too
  });

  it("is idempotent — second push_disabled with same event_id is a no-op", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_optout_idem", { personaId: persona.id });
    const sentAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, messageVariantId: variant.id, sentAt });

    const payload = {
      event_id: "optout_idem_001",
      event_name: "push_disabled",
      external_user_id: user.externalId,
      occurred_at: new Date().toISOString(),
    };

    await POST(buildRequest("POST", payload, AUTH) as NextRequest);

    const betaAfterFirst = (await prisma.personaArmStats.findFirst({
      where: { personaId: persona.id, agentId: agent.id, variantId: variant.id },
    }))?.beta;

    // Second identical request — should be a no-op due to idempotency
    await POST(buildRequest("POST", payload, AUTH) as NextRequest);

    const betaAfterSecond = (await prisma.personaArmStats.findFirst({
      where: { personaId: persona.id, agentId: agent.id, variantId: variant.id },
    }))?.beta;

    expect(betaAfterFirst).toBe(betaAfterSecond); // no additional penalty
  });
});
