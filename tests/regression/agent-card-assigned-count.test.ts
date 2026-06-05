// tests/regression/agent-card-assigned-count.test.ts
//
// REGRESSION: the agent card's "Assigned" stat counts active cohort assignments
// (UserAgentAssignment rows with releasedAt IS NULL) per agent, distinct from
// "Reached" (COUNT(DISTINCT UserDecision.userId)). This pins the exact column
// names ("agentId", "releasedAt") and aggregation shape used by the $queryRaw in
// src/lib/cache/agents.ts → getCachedAgentCardStats. A future rename of either
// column would break this query here, not silently on production.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createUserAgentAssignment } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("agent card assigned-count query", () => {
  it("counts active (releasedAt IS NULL) assignments per agent", async () => {
    const agent = await createAgent({ name: "Cohort Agent" });

    // UserAgentAssignment.externalUserId is @unique (one active assignment per
    // user globally), so each row needs a distinct externalUserId.
    // 3 active (releasedAt null) + 1 released (releasedAt set) for this agent.
    await createUserAgentAssignment({ externalUserId: "user-1", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "user-2", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "user-3", agentId: agent.id });
    await createUserAgentAssignment({
      externalUserId: "user-4",
      agentId: agent.id,
      releasedAt: new Date("2026-01-01T00:00:00Z"),
      releaseReason: "cohort_exit",
    });

    // Exact $queryRaw pattern used in src/lib/cache/agents.ts.
    const rows = await prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
      SELECT "agentId", COUNT(*)::bigint AS cnt
      FROM "UserAgentAssignment"
      WHERE "releasedAt" IS NULL
      GROUP BY "agentId"
    `;

    const mine = rows.find((r) => r.agentId === agent.id);
    expect(Number(mine?.cnt)).toBe(3);
  });

  it("returns no row for an agent with only released assignments", async () => {
    const agent = await createAgent({ name: "Released-Only Agent" });

    await createUserAgentAssignment({
      externalUserId: "user-5",
      agentId: agent.id,
      releasedAt: new Date("2026-01-01T00:00:00Z"),
      releaseReason: "conversion",
    });

    const rows = await prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
      SELECT "agentId", COUNT(*)::bigint AS cnt
      FROM "UserAgentAssignment"
      WHERE "releasedAt" IS NULL
      GROUP BY "agentId"
    `;

    expect(rows.find((r) => r.agentId === agent.id)).toBeUndefined();
  });
});
