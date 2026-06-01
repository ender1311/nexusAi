// Regression: per-agent gift metrics query. Locks the exact SQL column aliases
// and the derived metrics (count, revenue, conversion rate, avg time-to-gift).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createDecision } from "../helpers/builders";
import { agentGiftMetrics } from "@/lib/cache/agent-gift-metrics";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("agentGiftMetrics", () => {
  it("computes count, revenue, conversion rate, and avg time-to-gift", async () => {
    const agent = await createAgent({ status: "active" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // 4 sends; 1 becomes an attributed gift 2 days after the send.
    for (const uid of ["a", "b", "c"]) {
      await createDecision({ agentId: agent.id, userId: `u_${uid}`, messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: `b_${uid}` });
    }
    const gift = await createDecision({ agentId: agent.id, userId: "u_gift", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_gift" });
    const conversionAt = new Date(sentAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    await prisma.userDecision.update({
      where: { id: gift.id },
      data: { conversionEvent: "gift_given", conversionAt, conversionValue: 80, reward: 0.6 },
    });

    const m = await agentGiftMetrics(agent.id);
    expect(m.giftCount).toBe(1);
    expect(m.giftRevenue).toBeCloseTo(80, 2);
    // 1 gift ÷ 4 sends = 25%
    expect(m.giftConversionRate).toBeCloseTo(25, 1);
    // avg time-to-gift ≈ 2 days, expressed in hours
    expect(m.avgTimeToGiftHours).toBeCloseTo(48, 0);
  });

  it("returns zeros for an agent with no gifts", async () => {
    const agent = await createAgent({ status: "active" });
    const m = await agentGiftMetrics(agent.id);
    expect(m).toEqual({ giftCount: 0, giftRevenue: 0, giftConversionRate: 0, avgTimeToGiftHours: 0 });
  });
});
