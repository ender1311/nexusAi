// Regression: getCachedFleetGiftStats aggregates gift count + USD revenue.
// Locks the exact SQL column aliases the cache layer reads, so a column rename
// in the query can't silently zero out the dashboard gift metric.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createDecision } from "../helpers/builders";
import { getCachedFleetGiftStats } from "@/lib/cache/dashboard";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("getCachedFleetGiftStats", () => {
  it("sums attributed gift count and USD revenue in the 30-day window", async () => {
    const agent = await createAgent({ status: "active" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Two attributed gifts: $100 and $50.
    for (const [uid, value] of [["u_g1", 100], ["u_g2", 50]] as const) {
      const d = await createDecision({ agentId: agent.id, userId: uid, messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: `b_${uid}` });
      await prisma.userDecision.update({
        where: { id: d.id },
        data: { conversionEvent: "gift_given", conversionAt: new Date(), conversionValue: value, reward: 0.5 },
      });
    }
    // A non-gift conversion must be excluded from the sums.
    const other = await createDecision({ agentId: agent.id, userId: "u_o", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_o" });
    await prisma.userDecision.update({ where: { id: other.id }, data: { conversionEvent: "plan_started", conversionAt: new Date(), reward: 0.1 } });

    // A recurring-giver (Sower) conversion must be counted in sowerCount, not giftCount.
    const sower = await createDecision({ agentId: agent.id, userId: "u_s", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_s" });
    await prisma.userDecision.update({ where: { id: sower.id }, data: { conversionEvent: "sower_subscribed", conversionAt: new Date(), reward: 1.0 } });

    const stats = await getCachedFleetGiftStats();
    expect(stats.giftCount).toBe(2);
    expect(stats.giftRevenue).toBeCloseTo(150, 2);
    expect(stats.sowerCount).toBe(1);
    expect(stats.leaderboard[0]?.agentId).toBe(agent.id);
    expect(stats.leaderboard[0]?.revenue).toBeCloseTo(150, 2);
  });
});
