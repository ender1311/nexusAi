// tests/regression/agents-unique-users-column.test.ts
//
// REGRESSION: agents page crashed with "externalUserId" column name in $queryRaw.
// The UserDecision table stores the plain string user identifier in the "userId"
// column, not "externalUserId". A $queryRaw using the wrong column name caused a
// Postgres error that crashed the /agents page render. Fixed in src/app/agents/page.tsx
// (line 82) by correcting the column name to "userId".
//
// This test exercises the exact SQL shape used by the page so a future rename
// of that column will break the query here, not silently on production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agents page crashed with externalUserId column name", () => {
  it("COUNT(DISTINCT userId) aggregates correctly per agent using the real column name", async () => {
    const agentA = await createAgent({ name: "Agent A" });
    const agentB = await createAgent({ name: "Agent B" });

    // Agent A: 3 decisions across 2 distinct users
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "user-1", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "user-1", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "user-2", channel: "push" } });

    // Agent B: 2 decisions for 1 distinct user
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "user-3", channel: "email" } });
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "user-3", channel: "email" } });

    // This is the exact $queryRaw pattern used in src/app/agents/page.tsx.
    // Using "externalUserId" here would throw: column "externalUserId" does not exist.
    const rows = await prisma.$queryRaw<{ agentId: string; cnt: bigint }[]>`
      SELECT "agentId", COUNT(DISTINCT "userId") AS cnt
      FROM "UserDecision"
      GROUP BY "agentId"
    `;

    const byAgent = new Map(rows.map((r) => [r.agentId, Number(r.cnt)]));

    expect(byAgent.get(agentA.id)).toBe(2);
    expect(byAgent.get(agentB.id)).toBe(1);
  });

  it("returns empty result set when no UserDecision rows exist", async () => {
    await createAgent({ name: "Lonely Agent" });

    const rows = await prisma.$queryRaw<{ agentId: string; cnt: bigint }[]>`
      SELECT "agentId", COUNT(DISTINCT "userId") AS cnt
      FROM "UserDecision"
      GROUP BY "agentId"
    `;

    expect(rows).toHaveLength(0);
  });
});
