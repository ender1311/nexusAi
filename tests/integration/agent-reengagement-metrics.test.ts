import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createFunnelTransition, createUserAgentAssignment } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("per-agent re-engagement aggregation", () => {
  it("counts attributed recoveries and currently-owned users for one agent", async () => {
    const agent = await createAgent();
    const other = await createAgent({ name: "Other" });

    await createFunnelTransition({ externalUserId: "u1", fromStage: "lapsed_mau", toStage: "wau", recoveryRank: 2, attributedAgentId: agent.id });
    await createFunnelTransition({ externalUserId: "u2", fromStage: "lapsed_dau4", toStage: "dau4", recoveryRank: 3, attributedAgentId: agent.id });
    await createFunnelTransition({ externalUserId: "u3", fromStage: "lapsed_mau", toStage: "mau", recoveryRank: 1, attributedAgentId: other.id });
    await createFunnelTransition({ externalUserId: "u4", fromStage: "lapsed_wau", toStage: "wau", recoveryRank: 2, attributedAgentId: null });

    await createUserAgentAssignment({ externalUserId: "owned1", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "owned2", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "released1", agentId: agent.id, releasedAt: new Date(), releaseReason: "conversion" });

    const recoveries = await prisma.funnelTransition.count({ where: { attributedAgentId: agent.id } });
    const owned = await prisma.userAgentAssignment.count({ where: { agentId: agent.id, releasedAt: null } });
    const breakdown = await prisma.funnelTransition.groupBy({
      by: ["fromStage", "toStage"],
      where: { attributedAgentId: agent.id },
      _count: { _all: true },
    });

    expect(recoveries).toBe(2);
    expect(owned).toBe(2);
    expect(breakdown.length).toBe(2);
  });
});
