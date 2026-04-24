import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createGoal, createMessage, createVariant,
  createUser, createPersona, createUserDecision,
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
