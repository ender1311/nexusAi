// Regression: getCachedControlTowerStats feeds the control-tower stats bar.
// Pins its return shape {trackedUsers, personas, totalDecisions, totalConversions}
// and verifies the UI-unused `agents` count was dropped — a perf change that also
// moved the fn off the hourly-busted "dashboard-stats" tag (DAY TTL now), so the two
// full-table scans on TrackedUser/UserDecision (~19M rows each) no longer re-run every
// hour. The counts must still come out correct from the underlying queries.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createPersona, createUserDecision } from "../helpers/builders";
import { getCachedControlTowerStats } from "@/lib/cache";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: getCachedControlTowerStats shape + counts", () => {
  it("returns trackedUsers/personas/totalDecisions/totalConversions and omits the unused agents count", async () => {
    const agent = await createAgent({ name: "CT" });
    await createPersona({ name: "P1", isActive: true });
    await createPersona({ name: "P2", isActive: false }); // inactive — must not be counted
    await prisma.trackedUser.create({ data: { externalId: "tu1" } });
    await prisma.trackedUser.create({ data: { externalId: "tu2" } });
    await createUserDecision({ agentId: agent.id, userId: "tu1", channel: "push" });
    await createUserDecision({ agentId: agent.id, userId: "tu2", channel: "push", conversionAt: new Date() });

    const stats = await getCachedControlTowerStats();

    expect(stats.trackedUsers).toBe(2);
    expect(stats.personas).toBe(1); // only the active persona
    expect(stats.totalDecisions).toBe(2);
    expect(stats.totalConversions).toBe(1);
    // perf regression guard: the dead, UI-unused agent.count() query was removed
    expect(stats).not.toHaveProperty("agents");
  });

  it("returns zeros on an empty database", async () => {
    const stats = await getCachedControlTowerStats();

    expect(stats.trackedUsers).toBe(0);
    expect(stats.personas).toBe(0);
    expect(stats.totalDecisions).toBe(0);
    expect(stats.totalConversions).toBe(0);
  });
});
