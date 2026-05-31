// tests/regression/agent-card-stats-columns.test.ts
//
// REGRESSION (Wave 5): the agents-list per-agent card stats (unique users, push
// sends/opens) and the agent-detail delivered/pending split were uncached inline
// $queryRaw in page components. Wave 5 moved them into cached helpers in
// src/lib/cache/agents.ts (getCachedAgentCardStats, getCachedAgentDecisionSplit).
//
// These tests pin the exact SQL column names those helpers depend on:
//   - "scheduledFor" gates delivered vs pending (NULL or <= NOW() = delivered)
//   - "pushOpenAt" + channel = 'push' drives push opens
//   - "userId" is the string user identifier (not "externalUserId")
// A future column rename will break here, not silently on the production page.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agent card-stats / decision-split SQL column names", () => {
  it("splits delivered vs pending by scheduledFor relative to NOW()", async () => {
    const agent = await createAgent({ name: "Split Agent" });
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    // delivered: scheduledFor NULL, or in the past
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push", scheduledFor: past } });
    // pending: scheduledFor in the future
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u3", channel: "push", scheduledFor: future } });

    // Exact SQL from getCachedAgentDecisionSplit.
    const rows = await prisma.$queryRaw<Array<{ delivered: bigint; pending: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE "scheduledFor" IS NULL OR "scheduledFor" <= NOW()) AS delivered,
        COUNT(*) FILTER (WHERE "scheduledFor" IS NOT NULL AND "scheduledFor" > NOW()) AS pending
      FROM "UserDecision"
      WHERE "agentId" = ${agent.id}
    `;
    expect(Number(rows[0]?.delivered ?? 0)).toBe(2);
    expect(Number(rows[0]?.pending ?? 0)).toBe(1);
  });

  it("counts push sends (delivered) and opens via pushOpenAt per agent", async () => {
    const agent = await createAgent({ name: "Push Agent" });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const openedAt = new Date();

    // delivered push, opened
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p1", channel: "push", pushOpenAt: openedAt } });
    // delivered push, not opened
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p2", channel: "push" } });
    // future-scheduled push — excluded from sends but its open (if any) still counts in opens filter
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p3", channel: "push", scheduledFor: future } });
    // non-push — excluded entirely
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "p4", channel: "email" } });

    // Exact SQL from getCachedAgentCardStats (push portion).
    const rows = await prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
      SELECT "agentId",
             COUNT(*) FILTER (
               WHERE "channel" = 'push'
                 AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
             ) AS sends,
             COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
      FROM "UserDecision"
      GROUP BY "agentId"
    `;
    const row = rows.find((r) => r.agentId === agent.id);
    expect(Number(row?.sends ?? 0)).toBe(2);
    expect(Number(row?.opens ?? 0)).toBe(1);
  });
});
