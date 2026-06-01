// Regression: spec C2 fleet recovery aggregations. Pins exact column names returned
// by getCachedFleetRecoveryStats so a future $queryRaw rename can't silently zero them.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createAgent, createFunnelTransition, createUserAgentAssignment } from "../helpers/builders";
import { getCachedFleetRecoveryStats, getCachedRecoveryLeaderboard } from "@/lib/cache";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("fleet recovery aggregations", () => {
  it("returns recoveries30d + fleetRecoveryRate with correct counts", async () => {
    const a = await createAgent();
    await createFunnelTransition({ externalUserId: "u1", fromStage: "lapsed_mau", toStage: "wau", recoveryRank: 2, attributedAgentId: a.id });
    await createFunnelTransition({ externalUserId: "u2", fromStage: "lapsed_wau", toStage: "wau", recoveryRank: 2, attributedAgentId: null });
    await createUserAgentAssignment({ externalUserId: "owned", agentId: a.id, startedAt: new Date() });

    const stats = await getCachedFleetRecoveryStats();
    expect(stats).toHaveProperty("recoveries30d");
    expect(stats).toHaveProperty("attributedRecoveries30d");
    expect(stats).toHaveProperty("fleetRecoveryRate");
    expect(stats.recoveries30d).toBe(2);
    expect(stats.attributedRecoveries30d).toBe(1);
  });

  it("leaderboard rows expose agentId/recoveries/reward", async () => {
    const a = await createAgent({ name: "Climber" });
    await createFunnelTransition({ externalUserId: "x", fromStage: "lapsed_dau4", toStage: "dau4", recoveryRank: 3, attributedAgentId: a.id });
    const rows = await getCachedRecoveryLeaderboard();
    const row = rows.find((r) => r.agentId === a.id);
    expect(row).toBeDefined();
    expect(row!.recoveries).toBe(1);
  });
});
