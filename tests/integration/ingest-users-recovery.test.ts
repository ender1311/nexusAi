import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createUserDecision, createUserAgentAssignment,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => { await truncateAll(); process.env.INGEST_API_KEY = "test_ingest_key"; });
afterEach(async () => { await truncateAll(); delete process.env.INGEST_API_KEY; });

async function syncUser(externalId: string, funnel_stage: string) {
  const req = buildRequest("POST", { users: [{ external_user_id: externalId, funnel_stage, attributes: {} }] }, AUTH);
  return POST(req as NextRequest);
}

describe("POST /api/ingest/users — funnel recovery detection", () => {
  it("owned user recovery: credits owning agent, converts decision, releases, writes attributed transition", async () => {
    const persona = await createPersona({ label: "Re-engager" });
    const agent = await createAgent({ funnelStage: "lapsed" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_rec", { personaId: persona.id, funnelStage: "lapsed_mau" });
    const decision = await createUserDecision({
      agentId: agent.id, userId: "usr_rec", messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    await createUserAgentAssignment({ externalUserId: "usr_rec", agentId: agent.id });

    const res = await syncUser("usr_rec", "dau4"); // lapsed_mau → dau4 = recovery, rank 3
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionEvent).toBe("funnel_recovery");
    expect(updated!.reward).toBeGreaterThan(0);

    const assignment = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "usr_rec" } });
    expect(assignment!.releasedAt).not.toBeNull();
    expect(assignment!.releaseReason).toBe("conversion");

    const transitions = await prisma.funnelTransition.findMany({ where: { externalUserId: "usr_rec" } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0].attributedAgentId).toBe(agent.id);
    expect(transitions[0].attributedDecisionId).toBe(decision.id);
    expect(transitions[0].recoveryRank).toBe(3);
  });

  it("unowned user recovery: organic transition, no reward, no release", async () => {
    const persona = await createPersona({ label: "Re-engager" });
    await createUser("usr_org", { personaId: persona.id, funnelStage: "lapsed_wau" });

    const res = await syncUser("usr_org", "wau"); // lapsed_wau → wau = recovery, rank 2
    expect(res.status).toBe(200);

    const transitions = await prisma.funnelTransition.findMany({ where: { externalUserId: "usr_org" } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0].attributedAgentId).toBeNull();
    expect(transitions[0].attributedDecisionId).toBeNull();
    expect(transitions[0].recoveryRank).toBe(2);
  });

  it("non-recovery transition writes no FunnelTransition (lapsed_dau4 → mau)", async () => {
    const persona = await createPersona({ label: "Re-engager" });
    await createUser("usr_no", { personaId: persona.id, funnelStage: "lapsed_dau4" });

    await syncUser("usr_no", "mau"); // NOT a recovery (rank 1 < 3)
    const transitions = await prisma.funnelTransition.findMany({ where: { externalUserId: "usr_no" } });
    expect(transitions).toHaveLength(0);
  });

  it("double-fire prevention: two syncs of the same transition credit/log once", async () => {
    const persona = await createPersona({ label: "Re-engager" });
    await createUser("usr_dup", { personaId: persona.id, funnelStage: "lapsed_mau" });

    await syncUser("usr_dup", "wau"); // recovery
    await syncUser("usr_dup", "wau"); // stored is now wau → no change → no new transition

    const transitions = await prisma.funnelTransition.findMany({ where: { externalUserId: "usr_dup" } });
    expect(transitions).toHaveLength(1);
  });
});
