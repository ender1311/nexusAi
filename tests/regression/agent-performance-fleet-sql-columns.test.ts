// tests/regression/agent-performance-fleet-sql-columns.test.ts
//
// REGRESSION: agent performance page uses $queryRaw with column aliases
// "fleet_sends" and "fleet_conversions". A typo in either alias (e.g. using
// camelCase "fleetSends") would cause the JS side to read undefined and silently
// compute NaN lift values. This test exercises the exact SQL shape so a future
// column rename breaks here, not silently in production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agent performance page fleet count SQL aliases", () => {
  it("returns fleet_sends and fleet_conversions with correct snake_case aliases", async () => {
    const agent = await createAgent({ name: "Agent A" });
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push", conversionAt: new Date() } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u3", channel: "email", conversionAt: new Date() } });

    // Exact query shape from src/app/agents/[id]/performance/page.tsx PerformanceContent
    const rows = await prisma.$queryRaw<[{ fleet_sends: bigint; fleet_conversions: bigint }]>`
      SELECT COUNT(*)::bigint AS fleet_sends, COUNT("conversionAt")::bigint AS fleet_conversions
      FROM "UserDecision"
      WHERE "sentAt" >= ${thirtyDaysAgo}
    `;

    expect(rows).toHaveLength(1);
    // Verify both aliases resolve (not undefined/null)
    expect(rows[0]!.fleet_sends).toBeDefined();
    expect(rows[0]!.fleet_conversions).toBeDefined();
    expect(Number(rows[0]!.fleet_sends)).toBe(3);
    expect(Number(rows[0]!.fleet_conversions)).toBe(2);
  });

  it("returns zero counts when no decisions exist in the window", async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await prisma.$queryRaw<[{ fleet_sends: bigint; fleet_conversions: bigint }]>`
      SELECT COUNT(*)::bigint AS fleet_sends, COUNT("conversionAt")::bigint AS fleet_conversions
      FROM "UserDecision"
      WHERE "sentAt" >= ${thirtyDaysAgo}
    `;

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.fleet_sends)).toBe(0);
    expect(Number(rows[0]!.fleet_conversions)).toBe(0);
  });
});

describe("regression: getCachedControlTowerStats fleet count SQL aliases", () => {
  it("returns total and conversions bigint columns from UserDecision scan", async () => {
    const agent = await createAgent({ name: "CT Agent" });

    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u1", channel: "push" } });
    await prisma.userDecision.create({ data: { agentId: agent.id, userId: "u2", channel: "push", conversionAt: new Date() } });

    // Exact query shape from getCachedControlTowerStats in src/lib/cache.ts
    const rows = await prisma.$queryRaw<[{ total: bigint; conversions: bigint }]>`
      SELECT COUNT(*)::bigint AS total, COUNT("conversionAt")::bigint AS conversions
      FROM "UserDecision"
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBeDefined();
    expect(rows[0]!.conversions).toBeDefined();
    expect(Number(rows[0]!.total)).toBe(2);
    expect(Number(rows[0]!.conversions)).toBe(1);
  });
});
