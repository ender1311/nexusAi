// tests/regression/ingest-user-arm-stats-all-signal-paths.test.ts
//
// REGRESSION: Two signal paths were updating PersonaArmStats (persona-level
// prior) but silently skipping UserArmStats (per-user posterior):
//   1. push_disabled in /api/ingest/events — penalty never reached UserArmStats
//   2. Braze click rewards in /api/ingest/braze-events — click reward never
//      reached UserArmStats
// Consequence: per-user personalisation received zero signal from opt-outs
// and click events; arms stayed at the pessimistic Beta(1,30) prior forever.
// Fixed by adding upsertUserArmStats to both paths.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createMessage, createVariant,
  createUser, createPersona, createUserDecision, linkAgentToPersona,
} from "../helpers/builders";
import { POST as postEvents } from "@/app/api/ingest/events/route";
import { POST as postBrazeEvents } from "@/app/api/ingest/braze-events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("push_disabled updates UserArmStats (regression)", () => {
  it("opt-out penalty increments beta on UserArmStats, not just PersonaArmStats", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_optout_reg", { personaId: persona.id });
    await createUserDecision({
      agentId: agent.id, userId: user.externalId, messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 3600_000),
    });

    await postEvents(buildRequest("POST", {
      event_id: "reg_optout_001", event_name: "push_disabled",
      external_user_id: user.externalId, occurred_at: new Date().toISOString(),
    }, AUTH) as NextRequest);

    const userStats = await prisma.userArmStats.findFirst({
      where: { userId: user.externalId, agentId: agent.id, variantId: variant.id },
    });
    expect(userStats).not.toBeNull();
    expect(userStats!.beta).toBeGreaterThan(1); // penalty applied
  });
});

describe("Braze click reward updates UserArmStats (regression)", () => {
  it("click reward increments alpha and wins on UserArmStats, not just PersonaArmStats", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { brazeVariantId: "bv_reg_1" });
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_click_reg", { personaId: persona.id });
    await createUserDecision({
      agentId: agent.id, userId: user.externalId, messageVariantId: variant.id,
      channel: "push", sentAt: new Date(Date.now() - 1800_000),
    });

    await postBrazeEvents(buildRequest("POST", {
      events: [{
        id: "reg_braze_click_001",
        event_type: "users.messages.pushnotification.Open",
        user: { user_id: user.externalId },
        properties: { message_variation_id: variant.brazeVariantId },
      }],
    }, AUTH) as NextRequest);

    const userStats = await prisma.userArmStats.findFirst({
      where: { userId: user.externalId, agentId: agent.id, variantId: variant.id },
    });
    expect(userStats).not.toBeNull();
    expect(userStats!.wins).toBe(1);
    expect(userStats!.alpha).toBeGreaterThan(1); // click reward applied
  });
});
