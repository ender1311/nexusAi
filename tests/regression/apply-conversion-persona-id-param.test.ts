// tests/regression/apply-conversion-persona-id-param.test.ts
//
// REGRESSION (C2): applyConversion used to resolve the user's personaId with a
// per-call trackedUser.findFirst — an N+1 inside batch ingest. Callers that
// already know the personaId now pass it explicitly to skip the lookup. This
// test pins the contract: when `personaId` is supplied, PersonaArmStats is
// credited to THAT persona even if the trackedUser row has no personaId (or
// doesn't exist), proving the lookup is skipped and the passed value is used.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createGoal,
  createMessage,
  createVariant,
  createPersona,
  createDecision,
} from "../helpers/builders";
import { applyConversion } from "@/lib/services/attribution-service";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

async function loadDecision(id: string) {
  const decision = await prisma.userDecision.findUniqueOrThrow({
    where: { id },
    include: { agent: { include: { goals: true } } },
  });
  return decision;
}

describe("regression: applyConversion personaId param skips the user lookup", () => {
  it("credits PersonaArmStats to the passed personaId without a trackedUser row", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const persona = await createPersona({ name: "Passed Persona" });

    // No trackedUser is created — the old findFirst would return null and skip
    // PersonaArmStats entirely. The passed personaId must drive the credit.
    const created = await createDecision({
      agentId: agent.id,
      userId: "user_no_tracked_row",
      messageVariantId: variant.id,
      channel: "push",
      brazeSendId: "braze_persona_param",
    });
    const decision = await loadDecision(created.id);

    await applyConversion({
      decision,
      conversionEvent: "gift_given",
      occurredAt: new Date(),
      properties: { gift_amount_usd: 25 },
      personaId: persona.id,
    });

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.wins).toBe(1);
  });

  it("passing personaId: null skips PersonaArmStats even if a trackedUser has a persona", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const persona = await createPersona({ name: "Ignored Persona" });

    // trackedUser HAS a persona, but caller passes null → no PersonaArmStats.
    await prisma.trackedUser.create({
      data: { externalId: "user_with_persona", attributes: {}, personaId: persona.id },
    });

    const created = await createDecision({
      agentId: agent.id,
      userId: "user_with_persona",
      messageVariantId: variant.id,
      channel: "push",
      brazeSendId: "braze_persona_null",
    });
    const decision = await loadDecision(created.id);

    await applyConversion({
      decision,
      conversionEvent: "gift_given",
      occurredAt: new Date(),
      properties: { gift_amount_usd: 25 },
      personaId: null,
    });

    const stats = await prisma.personaArmStats.findFirst({ where: { agentId: agent.id } });
    expect(stats).toBeNull();
  });
});
