// tests/regression/persona-arm-stats-updated-on-conversion.test.ts
//
// REGRESSION: PersonaArmStats was never updated in /api/ingest/events.
// The bandit algorithm would never learn from conversions — arms stayed at α=1,β=1 forever.
// Fixed in production-readiness Step 3.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createGoal, createMessage, createVariant, createUser, createPersona, createUserDecision } from "../helpers/builders";
import { POST } from "@/app/api/ingest/events/route";

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("PersonaArmStats updated on conversion (regression)", () => {
  it("positive reward increments alpha and wins", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_reg", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_reg", messageVariantId: variant.id, sentAt: new Date(Date.now() - 3600_000) });

    await POST(buildRequest("POST", {
      event_id: "ev_reg_1", event_name: "plan_started",
      external_user_id: "usr_reg", occurred_at: new Date().toISOString(),
    }, { Authorization: "Bearer test_ingest_key" }) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.tries).toBe(1);
    expect(stats!.wins).toBe(1);
    expect(stats!.alpha).toBeGreaterThan(1); // 1 + reward (0.1)
    expect(stats!.beta).toBe(1);             // unchanged
  });

  it("negative reward increments beta but not alpha", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "unsubscribe", tier: "worst", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_reg2", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_reg2", messageVariantId: variant.id, sentAt: new Date(Date.now() - 3600_000) });

    await POST(buildRequest("POST", {
      event_id: "ev_reg_2", event_name: "unsubscribe",
      external_user_id: "usr_reg2", occurred_at: new Date().toISOString(),
    }, { Authorization: "Bearer test_ingest_key" }) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.tries).toBe(1);
    expect(stats!.wins).toBe(0);
    expect(stats!.alpha).toBe(1);            // unchanged
    expect(stats!.beta).toBeGreaterThan(1);  // 1 + 1 = 2
  });

  it("zero reward still increments tries", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "app_open", tier: "good", valueWeight: 0.0 }); // weight 0 → reward 0
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_reg3", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_reg3", messageVariantId: variant.id, sentAt: new Date(Date.now() - 3600_000) });

    await POST(buildRequest("POST", {
      event_id: "ev_reg_3", event_name: "app_open",
      external_user_id: "usr_reg3", occurred_at: new Date().toISOString(),
    }, { Authorization: "Bearer test_ingest_key" }) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.tries).toBe(1);
  });
});
