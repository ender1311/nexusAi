// tests/regression/agents-unique-users-column.test.ts
//
// REGRESSION: agents page crashed with "externalUserId" column name in $queryRaw.
// The UserDecision table stores the plain string user identifier in the "userId"
// column, not "externalUserId". A $queryRaw using the wrong column name caused a
// Postgres error that crashed the /agents page render. The query lives in
// getCachedAgentCardStats (src/lib/cache/agents.ts) and uses "userId".
//
// REGRESSION (MR D — "Reached" scope): the unique-users count must mirror the
// per-agent performance page — only confirmed sends (brazeSendId IS NOT NULL)
// within the last 30 days (sentAt). Without the brazeSendId filter it counted
// never-sent lottery rows (sentAt defaults to now() at insert); without the
// 30-day window it scanned the full 19M+ row table. This test pins both, so a
// future query change breaks here, not silently on the production page.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agent unique-users (\"Reached\") card stat SQL", () => {
  it("counts DISTINCT confirmed-send users within 30 days, per agent", async () => {
    const agentA = await createAgent({ name: "Agent A" });
    const agentB = await createAgent({ name: "Agent B" });

    // Agent A: 3 confirmed sends across 2 distinct users (all recent).
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "user-1", channel: "push", brazeSendId: "a1" } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "user-1", channel: "push", brazeSendId: "a2" } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "user-2", channel: "push", brazeSendId: "a3" } });

    // Agent B: 2 confirmed sends for 1 distinct user.
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "user-3", channel: "email", brazeSendId: "b1" } });
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "user-3", channel: "email", brazeSendId: "b2" } });

    // Exact $queryRaw shape from getCachedAgentCardStats (uniqueUsers portion).
    // "externalUserId" here would throw: column "externalUserId" does not exist.
    const rows = await prisma.$queryRaw<{ agentId: string; cnt: bigint }[]>`
      SELECT "agentId", COUNT(DISTINCT "userId") AS cnt
      FROM "UserDecision"
      WHERE "brazeSendId" IS NOT NULL
        AND "sentAt" >= NOW() - INTERVAL '30 days'
      GROUP BY "agentId"
    `;

    const byAgent = new Map(rows.map((r) => [r.agentId, Number(r.cnt)]));
    expect(byAgent.get(agentA.id)).toBe(2);
    expect(byAgent.get(agentB.id)).toBe(1);
  });

  it("excludes never-sent rows (NULL brazeSendId) and sends older than 30 days", async () => {
    const agent = await createAgent({ name: "Filter Agent" });
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    // Counted: one recent confirmed send.
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "keep", channel: "push", brazeSendId: "k1" } });
    // Excluded: never sent (lottery row), brazeSendId NULL.
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "unsent", channel: "push" } });
    // Excluded: confirmed send but outside the 30-day window.
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "stale", channel: "push", brazeSendId: "old1", sentAt: old } });

    const rows = await prisma.$queryRaw<{ agentId: string; cnt: bigint }[]>`
      SELECT "agentId", COUNT(DISTINCT "userId") AS cnt
      FROM "UserDecision"
      WHERE "brazeSendId" IS NOT NULL
        AND "sentAt" >= NOW() - INTERVAL '30 days'
      GROUP BY "agentId"
    `;

    const byAgent = new Map(rows.map((r) => [r.agentId, Number(r.cnt)]));
    expect(byAgent.get(agent.id)).toBe(1);
  });

  it("returns empty result set when no qualifying rows exist", async () => {
    await createAgent({ name: "Lonely Agent" });

    const rows = await prisma.$queryRaw<{ agentId: string; cnt: bigint }[]>`
      SELECT "agentId", COUNT(DISTINCT "userId") AS cnt
      FROM "UserDecision"
      WHERE "brazeSendId" IS NOT NULL
        AND "sentAt" >= NOW() - INTERVAL '30 days'
      GROUP BY "agentId"
    `;

    expect(rows).toHaveLength(0);
  });
});
