// tests/regression/agents-push-open-rate-column.test.ts
//
// REGRESSION: the /agents list page computes per-agent push open rate with a
// $queryRaw FILTER aggregate over the UserDecision table. The sent/open counts
// rely on the exact column names "channel" and "pushOpenAt". A rename or typo in
// either column would throw a Postgres error and crash the page render.
//
// This test exercises the exact SQL shape used in src/app/agents/page.tsx so a
// future column rename breaks here, not silently on production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agents page push open rate FILTER aggregate", () => {
  it("counts push sends and opens per agent using the real column names", async () => {
    const agentA = await createAgent({ name: "Agent A" });
    const agentB = await createAgent({ name: "Agent B" });

    const opened = new Date();

    // Agent A: 3 push sends, 2 opened; plus 1 email (must be excluded from push sends)
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-1", channel: "push", pushOpenAt: opened } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-2", channel: "push", pushOpenAt: opened } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-3", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agentA.id, userId: "u-4", channel: "email", pushOpenAt: opened } });

    // Agent B: 2 push sends, 0 opened
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "u-5", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agentB.id, userId: "u-6", channel: "push" } });

    // Exact $queryRaw pattern used in src/app/agents/page.tsx.
    const rows = await prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
      SELECT "agentId",
             COUNT(*) FILTER (WHERE "channel" = 'push') AS sends,
             COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
      FROM "UserDecision"
      GROUP BY "agentId"
    `;

    const byAgent = new Map(rows.map((r) => [r.agentId, { sends: Number(r.sends), opens: Number(r.opens) }]));

    // Email decision is excluded from push sends.
    expect(byAgent.get(agentA.id)).toEqual({ sends: 3, opens: 2 });
    expect(byAgent.get(agentB.id)).toEqual({ sends: 2, opens: 0 });

    // Rate computation mirrors page.tsx: opens/sends*100, null when no push sends.
    const a = byAgent.get(agentA.id)!;
    expect((a.opens / a.sends) * 100).toBeCloseTo(66.666, 1);
  });
});
