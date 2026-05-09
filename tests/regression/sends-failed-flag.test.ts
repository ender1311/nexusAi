/**
 * Regression tests: `failed` flag on sends API
 *
 * Bug that prompted these tests: the sends list did not surface Braze delivery
 * failures — all sends appeared successful even when FailedBrazeSend records
 * existed. These tests ensure the failed flag is computed correctly from the
 * FailedBrazeSend.decisionIds JSON arrays.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createMessage,
  createVariant,
  createUser,
  createUserDecision,
} from "../helpers/builders";
import { GET } from "@/app/api/agents/[id]/sends/route";

async function getSends(agentId: string) {
  const req = new NextRequest(`http://localhost/api/agents/${agentId}/sends`);
  const res = await GET(req, { params: Promise.resolve({ id: agentId }) });
  const body = await res.json();
  return { res, rows: body.data as Array<{ id: string; failed: boolean }> };
}

async function seedFailedSend(agentId: string, variantId: string, decisionIds: string[]) {
  return prisma.failedBrazeSend.create({
    data: {
      agentId,
      variantId,
      channel: "push",
      decisionIds, // Prisma Json column — pass raw array, not JSON.stringify
      reason: "Braze 500 Internal Server Error",
    },
  });
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("sends failed flag: regression", () => {
  it("failed=false when no FailedBrazeSend records exist for agent", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-reg-ok");
    const decision = await createUserDecision({ agentId: agent.id, userId: "usr-reg-ok", messageVariantId: variant.id });

    const { rows } = await getSends(agent.id);
    const row = rows.find((r) => r.id === decision.id)!;
    expect(row.failed).toBe(false);
  });

  it("failed=true for every decision ID listed in FailedBrazeSend.decisionIds", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-reg-fail-a");
    await createUser("usr-reg-fail-b");
    const d1 = await createUserDecision({ agentId: agent.id, userId: "usr-reg-fail-a", messageVariantId: variant.id });
    const d2 = await createUserDecision({ agentId: agent.id, userId: "usr-reg-fail-b", messageVariantId: variant.id });

    await seedFailedSend(agent.id, variant.id, [d1.id, d2.id]);

    const { rows } = await getSends(agent.id);
    expect(rows.find((r) => r.id === d1.id)!.failed).toBe(true);
    expect(rows.find((r) => r.id === d2.id)!.failed).toBe(true);
  });

  it("failed flag is independent per-decision — one failed does not poison others", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-mixed-ok");
    await createUser("usr-mixed-fail");
    const good = await createUserDecision({ agentId: agent.id, userId: "usr-mixed-ok",   messageVariantId: variant.id });
    const bad  = await createUserDecision({ agentId: agent.id, userId: "usr-mixed-fail", messageVariantId: variant.id });

    // Only `bad` is in FailedBrazeSend
    await seedFailedSend(agent.id, variant.id, [bad.id]);

    const { rows } = await getSends(agent.id);
    expect(rows.find((r) => r.id === good.id)!.failed).toBe(false);
    expect(rows.find((r) => r.id === bad.id)!.failed).toBe(true);
  });

  it("FailedBrazeSend for a different agent does not affect this agent's decisions", async () => {
    const agentA  = await createAgent({ name: "Agent A" });
    const agentB  = await createAgent({ name: "Agent B" });
    const msgA    = await createMessage(agentA.id);
    const msgB    = await createMessage(agentB.id);
    const varA    = await createVariant(msgA.id);
    const varB    = await createVariant(msgB.id);
    await createUser("usr-xa");
    await createUser("usr-xb");
    const dA = await createUserDecision({ agentId: agentA.id, userId: "usr-xa", messageVariantId: varA.id });
    const dB = await createUserDecision({ agentId: agentB.id, userId: "usr-xb", messageVariantId: varB.id });

    // Mark agentB's decision as failed
    await seedFailedSend(agentB.id, varB.id, [dB.id]);

    // Query agentA — its decision should not be affected
    const { rows } = await getSends(agentA.id);
    expect(rows.find((r) => r.id === dA.id)!.failed).toBe(false);
  });

  it("failed flag works correctly after FailedBrazeSend with empty decisionIds array", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-empty-fail");
    const decision = await createUserDecision({ agentId: agent.id, userId: "usr-empty-fail", messageVariantId: variant.id });

    // FailedBrazeSend with empty decisionIds — should not affect any row
    await prisma.failedBrazeSend.create({
      data: {
        agentId: agent.id,
        variantId: variant.id,
        channel: "push",
        decisionIds: [],
        reason: "empty batch",
      },
    });

    const { rows } = await getSends(agent.id);
    expect(rows.find((r) => r.id === decision.id)!.failed).toBe(false);
  });
});
