// Regression: /api/metrics/push-summary and getCachedPerformanceMetrics both counted
// ALL UserDecision rows with channel='push' as "sends" — no brazeSendId IS NOT NULL filter.
// This inflated push send counts by ~33× for agents that had many scheduled-but-unsent
// decisions (Nova: 7.8K reported vs 230 actually dispatched). The agent card was correct
// because getCachedAgentCardStats already filtered by brazeSendId IS NOT NULL.
//
// Fix: add brazeSendId: { not: null } to push-summary groupBy WHERE clause and
// AND "brazeSendId" IS NOT NULL to the push_sends COUNT FILTER in getCachedPerformanceMetrics.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createAgent, createMessage, createVariant, createUser } from "../helpers/builders";
import { prisma } from "../helpers/db";

import { GET } from "@/app/api/metrics/push-summary/route";

beforeEach(async () => {
  await truncateAll();
  // push-summary uses sentAt >= 2026-05-16; we need that date to be in the past
});

afterEach(async () => {
  await truncateAll();
});

describe("push-summary: only counts decisions with brazeSendId (actually dispatched)", () => {
  it("excludes push decisions that have no brazeSendId (scheduled but not yet sent to Braze)", async () => {
    const agent = await createAgent({ name: "Push Agent" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_ps" });
    const variant = await createVariant(msg.id, { brazeVariantId: "var_ps" });
    await createUser("push_usr_01");

    const sentAt = new Date("2026-05-20T10:00:00.000Z");

    // One decision that was actually dispatched (brazeSendId set)
    await prisma.userDecision.create({
      data: {
        agentId: agent.id,
        userId: "push_usr_01",
        messageVariantId: variant.id,
        channel: "push",
        sentAt,
        brazeSendId: "braze_abc123",
      },
    });

    // Two decisions that are scheduled-but-not-sent (brazeSendId null) — the inflation case
    await prisma.userDecision.create({
      data: {
        agentId: agent.id,
        userId: "push_usr_01",
        messageVariantId: variant.id,
        channel: "push",
        sentAt: new Date("2026-05-21T10:00:00.000Z"),
        brazeSendId: null,
      },
    });
    await prisma.userDecision.create({
      data: {
        agentId: agent.id,
        userId: "push_usr_01",
        messageVariantId: variant.id,
        channel: "push",
        sentAt: new Date("2026-05-22T10:00:00.000Z"),
        brazeSendId: null,
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    const agentRow = body.data.byAgent.find((r: { agentId: string }) => r.agentId === agent.id);
    expect(agentRow).toBeDefined();
    // Only the 1 dispatched send should be counted, not 3
    expect(agentRow.pushSends).toBe(1);
    expect(body.data.totalPushSends).toBe(1);
  });

  it("counts all dispatched sends when brazeSendId is set", async () => {
    const agent = await createAgent({ name: "Multi Send Agent" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_ms" });
    const variant = await createVariant(msg.id, { brazeVariantId: "var_ms" });
    await createUser("push_usr_02");

    // Three dispatched sends
    for (let i = 0; i < 3; i++) {
      await prisma.userDecision.create({
        data: {
          agentId: agent.id,
          userId: "push_usr_02",
          messageVariantId: variant.id,
          channel: "push",
          sentAt: new Date(`2026-05-2${i + 1}T10:00:00.000Z`),
          brazeSendId: `braze_id_${i}`,
        },
      });
    }

    const res = await GET();
    const body = await res.json();

    const agentRow = body.data.byAgent.find((r: { agentId: string }) => r.agentId === agent.id);
    expect(agentRow.pushSends).toBe(3);
  });
});
