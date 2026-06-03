// tests/regression/lift-counts-push-columns.test.ts
//
// REGRESSION: the performance page's "Push Open Rate — Nexus vs Non-Nexus"
// comparison depends on getCachedLiftCounts() (src/lib/cache/performance.ts)
// counting push sends/opens via:
//   prisma.userDecision.count({ where: { channel: "push" } })
//   prisma.userDecision.count({ where: { channel: "push", pushOpenAt: { not: null } } })
// alongside the scored-send/conversion counts (reward IS NOT NULL / reward > 0).
//
// If any of those columns (channel, pushOpenAt, reward) is renamed/removed, the
// comparison silently breaks. This test exercises the exact four count queries
// over a lift window and asserts the derived counts.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createUser } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

async function seedDecision(params: {
  agentId: string;
  userId: string;
  channel: string;
  sentAt: Date;
  reward?: number | null;
  pushOpenAt?: Date | null;
}) {
  return prisma.userDecision.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      channel: params.channel,
      sentAt: params.sentAt,
      reward: params.reward ?? null,
      pushOpenAt: params.pushOpenAt ?? null,
    },
  });
}

describe("regression: getCachedLiftCounts push/scored count queries", () => {
  it("counts scored sends, conversions, push sends and push opens within the window", async () => {
    const agent = await createAgent();
    const user = await createUser("u-lift-counts");
    const inWindow = new Date("2026-05-20T12:00:00Z");
    const beforeWindow = new Date("2026-04-01T12:00:00Z");
    const liftSince = new Date("2026-05-01T00:00:00Z");

    // In-window push send, opened, positive reward → counts for all four metrics.
    await seedDecision({ agentId: agent.id, userId: user.externalId, channel: "push", sentAt: inWindow, reward: 1, pushOpenAt: inWindow });
    // In-window push send, opened, zero reward → scored + push send + push open (not a conversion).
    await seedDecision({ agentId: agent.id, userId: user.externalId, channel: "push", sentAt: inWindow, reward: 0, pushOpenAt: inWindow });
    // In-window push send, NOT opened, no reward → push send only (unscored, unopened).
    await seedDecision({ agentId: agent.id, userId: user.externalId, channel: "push", sentAt: inWindow, reward: null, pushOpenAt: null });
    // In-window email send, positive reward → scored + conversion, but NOT a push send/open.
    await seedDecision({ agentId: agent.id, userId: user.externalId, channel: "email", sentAt: inWindow, reward: 1, pushOpenAt: null });
    // Before-window push send, opened, positive reward → excluded by the date filter.
    await seedDecision({ agentId: agent.id, userId: user.externalId, channel: "push", sentAt: beforeWindow, reward: 1, pushOpenAt: beforeWindow });

    const filter = { gte: liftSince };
    const [sendsCount, conversionsCount, pushSendsCount, pushOpensCount] = await Promise.all([
      prisma.userDecision.count({ where: { sentAt: filter, reward: { not: null } } }),
      prisma.userDecision.count({ where: { sentAt: filter, reward: { gt: 0 } } }),
      prisma.userDecision.count({ where: { sentAt: filter, channel: "push" } }),
      prisma.userDecision.count({ where: { sentAt: filter, channel: "push", pushOpenAt: { not: null } } }),
    ]);

    // scored sends (reward not null, in window): the two push + the email = 3
    expect(sendsCount).toBe(3);
    // positive conversions (reward > 0, in window): one push + one email = 2
    expect(conversionsCount).toBe(2);
    // push sends in window: three push rows = 3
    expect(pushSendsCount).toBe(3);
    // push opens in window: two opened push rows = 2
    expect(pushOpensCount).toBe(2);
  });
});
