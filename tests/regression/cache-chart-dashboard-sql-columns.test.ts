// Regression: getCachedChartDecisions, getCachedVariantMetrics, and
// getCachedDashboardCounts each run hand-written $queryRaw with explicit column
// aliases (sends/conversions/scored/positive/hour/dow/variant_id/channel/
// sent_last24h/total_*). A column rename in the SQL string would silently zero the
// dashboard + performance charts with no type error. These tests pin the exact
// returned keys and values so drift fails loudly. CLAUDE.md mandates a column-drift
// regression test for every raw-SQL read query; this was the largest unguarded
// surface (the chart/dashboard cache layer had none).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createUserDecision } from "../helpers/builders";
import { getCachedChartDecisions, getCachedVariantMetrics } from "@/lib/cache/performance";
import { getCachedDashboardCounts } from "@/lib/cache/dashboard";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

// Seed a coherent set of recent (within 24h / 30d) push decisions:
//  - d1: scored conversion with a positive reward + a push open
//  - d2: scored, no conversion, no open, reward 0
async function seed() {
  const agent = await createAgent({ name: "Chart Agent", status: "active" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const variant = await createVariant(msg.id);
  const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago → in 24h + 30d windows

  const d1 = await createUserDecision({
    agentId: agent.id,
    userId: "cu1",
    messageVariantId: variant.id,
    channel: "push",
    sentAt,
    conversionAt: new Date(),
    pushOpenAt: new Date(),
  });
  await prisma.userDecision.update({ where: { id: d1.id }, data: { reward: 1.0 } });

  const d2 = await createUserDecision({
    agentId: agent.id,
    userId: "cu2",
    messageVariantId: variant.id,
    channel: "push",
    sentAt,
  });
  await prisma.userDecision.update({ where: { id: d2.id }, data: { reward: 0 } });

  return { agentId: agent.id, variantId: variant.id };
}

describe("getCachedChartDecisions raw-SQL columns", () => {
  it("returns byDate/heatmap/rewardByDate/hourly with the expected keys and counts", async () => {
    await seed();
    const data = await getCachedChartDecisions();

    expect(data).toHaveProperty("byDate");
    expect(data).toHaveProperty("heatmap");
    expect(data).toHaveProperty("rewardByDate");
    expect(data).toHaveProperty("hourly");

    const totalSends = data.byDate.reduce((s, r) => s + r.sends, 0);
    const totalConversions = data.byDate.reduce((s, r) => s + r.conversions, 0);
    expect(totalSends).toBe(2);
    expect(totalConversions).toBe(1);
    expect(Object.keys(data.byDate[0])).toEqual(expect.arrayContaining(["date", "sends", "conversions"]));

    expect(Object.keys(data.heatmap[0])).toEqual(expect.arrayContaining(["hour", "dow", "count"]));
    expect(data.heatmap.reduce((s, r) => s + r.count, 0)).toBe(2);

    // reward IS NOT NULL on both rows; reward > 0 on exactly one
    const scored = data.rewardByDate.reduce((s, r) => s + r.scored, 0);
    const positive = data.rewardByDate.reduce((s, r) => s + r.positive, 0);
    expect(scored).toBe(2);
    expect(positive).toBe(1);
    expect(Object.keys(data.rewardByDate[0])).toEqual(expect.arrayContaining(["date", "scored", "positive"]));

    expect(Object.keys(data.hourly[0])).toEqual(expect.arrayContaining(["hour", "sends", "conversions", "convRate"]));
  });
});

describe("getCachedVariantMetrics raw-SQL columns", () => {
  it("returns variantSends/variantConversions/variantRewards keyed by messageVariantId", async () => {
    const { variantId } = await seed();
    const data = await getCachedVariantMetrics();

    const sendRow = data.variantSends.find((r) => r.messageVariantId === variantId);
    expect(sendRow).toBeDefined();
    expect(sendRow!.channel).toBe("push");
    expect(sendRow!._count.id).toBe(2);

    const convRow = data.variantConversions.find((r) => r.messageVariantId === variantId);
    expect(convRow!._count.id).toBe(1);

    const rewardRow = data.variantRewards.find((r) => r.messageVariantId === variantId);
    expect(rewardRow!._sum.reward).toBeCloseTo(1.0, 2);
  });
});

describe("getCachedDashboardCounts raw-SQL columns", () => {
  it("returns the five count fields with correct values", async () => {
    await seed();
    const counts = await getCachedDashboardCounts();

    expect(Object.keys(counts)).toEqual(
      expect.arrayContaining([
        "sentLast24h",
        "totalDecisions",
        "totalConversions",
        "totalPushSends",
        "totalPushOpens",
      ]),
    );
    expect(counts.sentLast24h).toBe(2);
    expect(counts.totalDecisions).toBe(2);
    expect(counts.totalConversions).toBe(1);
    expect(counts.totalPushSends).toBe(2);
    expect(counts.totalPushOpens).toBe(1);
  });
});
