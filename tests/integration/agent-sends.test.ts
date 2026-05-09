import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createPersona,
  createMessage,
  createVariant,
  createUser,
  createUserDecision,
} from "../helpers/builders";
import { GET } from "@/app/api/agents/[id]/sends/route";

// Helper: call the GET handler with the given agent ID and optional query params
async function getSends(agentId: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `http://localhost/api/agents/${agentId}/sends${qs ? `?${qs}` : ""}`;
  const req = new NextRequest(url);
  const res = await GET(req, { params: Promise.resolve({ id: agentId }) });
  return { res, body: await res.json() };
}

// Helper: create a FailedBrazeSend record with correct schema
async function createFailedSend(agentId: string, variantId: string, decisionIds: string[]) {
  return prisma.failedBrazeSend.create({
    data: {
      agentId,
      variantId,
      channel: "push",
      decisionIds, // Prisma Json column — pass raw array, not JSON.stringify
      reason: "Braze error",
    },
  });
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/agents/[id]/sends", () => {
  it("returns 404 for unknown agent", async () => {
    const { res } = await getSends("nonexistent-agent-id");
    expect(res.status).toBe(404);
  });

  it("returns empty data array for agent with no sends", async () => {
    const agent = await createAgent();
    const { res, body } = await getSends(agent.id);
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns send rows with correct shape", async () => {
    const persona = await createPersona({ name: "Seekers" });
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "V1", body: "Hello world", title: "Title" });
    await createUser("usr-shape", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr-shape", messageVariantId: variant.id });

    const { res, body } = await getSends(agent.id);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);

    const row = body.data[0];
    expect(row.userId).toBe("usr-shape");
    expect(row.channel).toBe("push");
    expect(row.variantId).toBe(variant.id);
    expect(row.variantName).toBe("V1");
    expect(row.variantTitle).toBe("Title");
    expect(row.variantBody).toBe("Hello world");
    expect(row.personaName).toBe("Seekers");
    expect(row.failed).toBe(false);
    expect(typeof row.sentAt).toBe("string");
  });

  it("marks failed=false when decision is NOT in any FailedBrazeSend record", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-ok");
    const decision = await createUserDecision({ agentId: agent.id, userId: "usr-ok", messageVariantId: variant.id });

    const { body } = await getSends(agent.id);
    const row = body.data.find((r: { id: string }) => r.id === decision.id);
    expect(row).toBeDefined();
    expect(row.failed).toBe(false);
  });

  it("marks failed=true when decision ID appears in FailedBrazeSend.decisionIds", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-fail");
    const decision = await createUserDecision({ agentId: agent.id, userId: "usr-fail", messageVariantId: variant.id });

    await createFailedSend(agent.id, variant.id, [decision.id]);

    const { body } = await getSends(agent.id);
    const row = body.data.find((r: { id: string }) => r.id === decision.id);
    expect(row).toBeDefined();
    expect(row.failed).toBe(true);
  });

  it("marks only the correct decision as failed when multiple decisions exist", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-ok2");
    await createUser("usr-fail2");
    const goodDecision = await createUserDecision({ agentId: agent.id, userId: "usr-ok2",   messageVariantId: variant.id });
    const badDecision  = await createUserDecision({ agentId: agent.id, userId: "usr-fail2", messageVariantId: variant.id });

    await createFailedSend(agent.id, variant.id, [badDecision.id]);

    const { body } = await getSends(agent.id);
    const good = body.data.find((r: { id: string }) => r.id === goodDecision.id);
    const bad  = body.data.find((r: { id: string }) => r.id === badDecision.id);
    expect(good.failed).toBe(false);
    expect(bad.failed).toBe(true);
  });

  it("marks failed=true for decisions across multiple FailedBrazeSend records", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-a");
    await createUser("usr-b");
    const d1 = await createUserDecision({ agentId: agent.id, userId: "usr-a", messageVariantId: variant.id });
    const d2 = await createUserDecision({ agentId: agent.id, userId: "usr-b", messageVariantId: variant.id });

    // Two separate FailedBrazeSend records, each covering one decision
    await createFailedSend(agent.id, variant.id, [d1.id]);
    await createFailedSend(agent.id, variant.id, [d2.id]);

    const { body } = await getSends(agent.id);
    const r1 = body.data.find((r: { id: string }) => r.id === d1.id);
    const r2 = body.data.find((r: { id: string }) => r.id === d2.id);
    expect(r1.failed).toBe(true);
    expect(r2.failed).toBe(true);
  });

  it("a single FailedBrazeSend covering multiple decisions marks all as failed", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-m1");
    await createUser("usr-m2");
    await createUser("usr-m3");
    const d1 = await createUserDecision({ agentId: agent.id, userId: "usr-m1", messageVariantId: variant.id });
    const d2 = await createUserDecision({ agentId: agent.id, userId: "usr-m2", messageVariantId: variant.id });
    const d3 = await createUserDecision({ agentId: agent.id, userId: "usr-m3", messageVariantId: variant.id });

    // One FailedBrazeSend covering all three
    await createFailedSend(agent.id, variant.id, [d1.id, d2.id, d3.id]);

    const { body } = await getSends(agent.id);
    for (const id of [d1.id, d2.id, d3.id]) {
      const row = body.data.find((r: { id: string }) => r.id === id);
      expect(row.failed).toBe(true);
    }
  });

  it("FailedBrazeSend from agentB does not affect agentA sends", async () => {
    const agentA = await createAgent({ name: "Agent A" });
    const agentB = await createAgent({ name: "Agent B" });
    const msgA = await createMessage(agentA.id);
    const msgB = await createMessage(agentB.id);
    const variantA = await createVariant(msgA.id);
    const variantB = await createVariant(msgB.id);
    await createUser("usr-cross-a");
    await createUser("usr-cross-b");
    const dA = await createUserDecision({ agentId: agentA.id, userId: "usr-cross-a", messageVariantId: variantA.id });
    const dB = await createUserDecision({ agentId: agentB.id, userId: "usr-cross-b", messageVariantId: variantB.id });

    // Only agentB's decision is failed
    await createFailedSend(agentB.id, variantB.id, [dB.id]);

    // Query agentA — dA must not be marked failed
    const { body } = await getSends(agentA.id);
    const row = body.data.find((r: { id: string }) => r.id === dA.id);
    expect(row.failed).toBe(false);
  });

  it("returns rows ordered by sentAt descending", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr-ord");

    const older = new Date(Date.now() - 2 * 60 * 1000);
    const newer = new Date(Date.now() - 1 * 60 * 1000);
    const d1 = await createUserDecision({ agentId: agent.id, userId: "usr-ord", sentAt: older });
    const d2 = await createUserDecision({ agentId: agent.id, userId: "usr-ord", sentAt: newer });

    const { body } = await getSends(agent.id);
    const ids = body.data.map((r: { id: string }) => r.id);
    expect(ids.indexOf(d2.id)).toBeLessThan(ids.indexOf(d1.id));
  });

  it("respects pagination limit parameter", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-page");

    for (let i = 0; i < 5; i++) {
      await createUserDecision({ agentId: agent.id, userId: "usr-page", messageVariantId: variant.id });
    }

    const { body } = await getSends(agent.id, { limit: "3" });
    expect(body.data).toHaveLength(3);
  });

  it("clamps limit above MAX_LIMIT to return all existing rows (not error)", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-limit");

    for (let i = 0; i < 3; i++) {
      await createUserDecision({ agentId: agent.id, userId: "usr-limit", messageVariantId: variant.id });
    }

    const { res, body } = await getSends(agent.id, { limit: "200" });
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3); // only 3 exist, cap doesn't cause error
  });

  it("returns personaName=null for users without a persona", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    // Create user without persona
    await prisma.trackedUser.create({
      data: { externalId: "usr-no-persona", funnelStage: "wau" },
    });
    await createUserDecision({ agentId: agent.id, userId: "usr-no-persona", messageVariantId: variant.id });

    const { body } = await getSends(agent.id);
    expect(body.data[0].personaName).toBeNull();
    expect(body.data[0].personaColor).toBeNull();
  });
});
