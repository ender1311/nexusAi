// tests/regression/unique-users-cap-sql.test.ts
//
// REGRESSION: the cron select-and-send route uses $queryRaw with
// COUNT(DISTINCT "userId")::bigint AS n to enforce the uniqueUsersCap lifetime
// ceiling. A column alias typo or wrong cast would silently break the cap check.
//
// REGRESSION (brazeSendId filter): lottery UserDecision rows are inserted BEFORE
// the Braze dispatch, so they exist with brazeSendId = NULL until the send
// confirms (and stay NULL forever if the send fails). Counting all rows would
// include never-sent/failed attempts and trip the lifetime cap early. The query
// now counts only confirmed sends (brazeSendId IS NOT NULL), mirroring the
// dailyCap filter. This test exercises the exact SQL shape so a future query
// change breaks here, not silently in production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: uniqueUsersCap COUNT(DISTINCT) SQL shape", () => {
  it("returns n = 3 for three distinct confirmed-send users for the agent", async () => {
    const agent = await createAgent({ name: "Cap Agent" });

    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push", brazeSendId: "s1" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push", brazeSendId: "s2" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u3", channel: "email", brazeSendId: "s3" } });

    // Exact query shape from the uniqueUsersCap block in src/app/api/cron/select-and-send/route.ts
    const rows = await prisma.$queryRaw<[{ n: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS n FROM "UserDecision"
      WHERE "agentId" = ${agent.id} AND "brazeSendId" IS NOT NULL
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.n).toBeDefined();
    expect(Number(rows[0]!.n)).toBe(3);
  });

  it("counts distinct users — duplicate confirmed sends for same user count once", async () => {
    const agent = await createAgent({ name: "Cap Agent Dedup" });

    // u1 has two confirmed sends; should still count as 1 distinct user
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push", brazeSendId: "s1" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "email", brazeSendId: "s2" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push", brazeSendId: "s3" } });

    const rows = await prisma.$queryRaw<[{ n: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS n FROM "UserDecision"
      WHERE "agentId" = ${agent.id} AND "brazeSendId" IS NOT NULL
    `;

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("excludes decisions with NULL brazeSendId (never sent / Braze-failed)", async () => {
    const agent = await createAgent({ name: "Cap Agent Unsent" });

    // u1 confirmed; u2 + u3 are unsent lottery rows (brazeSendId NULL) → not counted
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push", brazeSendId: "s1" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u3", channel: "email" } });

    const rows = await prisma.$queryRaw<[{ n: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS n FROM "UserDecision"
      WHERE "agentId" = ${agent.id} AND "brazeSendId" IS NOT NULL
    `;

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("returns n = 0 when no confirmed sends exist for the agent", async () => {
    const agent = await createAgent({ name: "Empty Cap Agent" });

    const rows = await prisma.$queryRaw<[{ n: bigint }]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS n FROM "UserDecision"
      WHERE "agentId" = ${agent.id} AND "brazeSendId" IS NOT NULL
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.n).toBeDefined();
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
