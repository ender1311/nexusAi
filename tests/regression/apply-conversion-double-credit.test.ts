// tests/regression/apply-conversion-double-credit.test.ts
//
// REGRESSION (audit fix #5): applyConversion used an unconditional
// userDecision.update + arm-stat increment, so two concurrent retries crediting
// the same decision both ran the arm-stat updates → double-counted wins/alpha.
// The fix flips conversionAt from null with updateMany and bails when count===0,
// so only the first caller credits. This test calls applyConversion twice on the
// same already-credited decision and asserts the arm stats are credited once.

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
  return prisma.userDecision.findUniqueOrThrow({
    where: { id },
    include: { agent: { include: { goals: true } } },
  });
}

describe("regression: applyConversion credits exactly once under repeated calls", () => {
  it("does not double-credit PersonaArmStats / UserArmStats when re-run on a credited decision", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const persona = await createPersona({ name: "Giver" });

    const created = await createDecision({
      agentId: agent.id,
      userId: "user_retry",
      messageVariantId: variant.id,
      channel: "push",
      brazeSendId: "braze_retry",
    });
    const decision = await loadDecision(created.id);

    // Two attributions for the same decision (simulating a retried ingest).
    await applyConversion({ decision, conversionEvent: "gift_given", occurredAt: new Date(), properties: { gift_amount_usd: 25 }, personaId: persona.id });
    const second = await applyConversion({ decision, conversionEvent: "gift_given", occurredAt: new Date(), properties: { gift_amount_usd: 25 }, personaId: persona.id });

    // Second call still reports the computed reward but performs no side effects.
    expect(second.reward).toBeGreaterThan(0);

    const personaStats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(personaStats!.wins).toBe(1);

    const userStats = await prisma.userArmStats.findFirst({ where: { agentId: agent.id, variantId: variant.id } });
    expect(userStats!.wins).toBe(1);

    // Decision is credited once.
    const finalDecision = await prisma.userDecision.findUniqueOrThrow({ where: { id: created.id } });
    expect(finalDecision.conversionEvent).toBe("gift_given");
  });
});
