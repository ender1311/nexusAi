// tests/regression/sower-metric-columns.test.ts
//
// REGRESSION: the Sower (recurring-giver) dashboard metric is computed via $queryRaw
// in src/lib/cache/agent-gift-metrics.ts (per-agent) and src/lib/cache/dashboard.ts
// (fleet). Both COUNT(*) FILTER on the literal conversionEvent value 'sower_subscribed'.
// A rename of the column ("conversionEvent"/"sentAt"/"conversionAt") or a drift in the
// canonical event name would silently zero the metric on production. These tests exercise
// the exact SQL shape so such a change breaks here, not silently in the dashboard.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { agentGiftMetrics } from "@/lib/cache/agent-gift-metrics";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: sower_subscribed metric SQL column names", () => {
  it("agentGiftMetrics counts sower_subscribed conversions and computes the rate", async () => {
    const agent = await createAgent({ status: "active" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    const now = new Date();
    const recent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    // 4 sends in window: 2 sower conversions, 1 gift, 1 unconverted.
    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "u1", channel: "push", messageVariantId: variant.id,
        sentAt: recent, conversionEvent: "sower_subscribed", conversionAt: now, reward: 1.0 },
    });
    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "u2", channel: "push", messageVariantId: variant.id,
        sentAt: recent, conversionEvent: "sower_subscribed", conversionAt: now, reward: 1.0 },
    });
    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "u3", channel: "push", messageVariantId: variant.id,
        sentAt: recent, conversionEvent: "gift_given", conversionAt: now, conversionValue: 50, reward: 0.5 },
    });
    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "u4", channel: "push", messageVariantId: variant.id, sentAt: recent },
    });

    const m = await agentGiftMetrics(agent.id);
    expect(m.sowerCount).toBe(2);
    expect(m.sowerConversionRate).toBeCloseTo((2 / 4) * 100, 5);
  });

  it("fleet sower query selects sower_count using the real column names", async () => {
    const agent = await createAgent({ status: "active" });
    const now = new Date();
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "f1", channel: "push", sentAt: recent,
        conversionEvent: "sower_subscribed", conversionAt: now, reward: 1.0 },
    });
    // Outside the 30-day conversionAt window — must be excluded.
    await prisma.userDecision.create({
      data: { agentId: agent.id, userId: "f2", channel: "push", sentAt: old,
        conversionEvent: "sower_subscribed", conversionAt: old, reward: 1.0 },
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Exact SQL shape from getCachedFleetGiftStats in src/lib/cache/dashboard.ts.
    const rows = await prisma.$queryRaw<[{ sower_count: bigint }]>`
      SELECT COUNT(*)::bigint AS sower_count
      FROM "UserDecision"
      WHERE "conversionEvent" = 'sower_subscribed'
        AND "conversionAt" >= ${thirtyDaysAgo}
    `;
    expect(Number(rows[0]?.sower_count ?? 0)).toBe(1);
  });
});
