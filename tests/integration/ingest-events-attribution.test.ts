import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createGoal, createUserDecision, createUserAgentAssignment,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => { await truncateAll(); process.env.INGEST_API_KEY = "test_ingest_key"; });
afterEach(async () => { await truncateAll(); delete process.env.INGEST_API_KEY; });

describe("POST /api/ingest/events — attribution via applyConversion", () => {
  it("attributes a goal event, rewards the arm, and releases an owning assignment", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "A" });
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 50 });
    await createUser("usr_evt", { personaId: persona.id });
    const decision = await createUserDecision({
      agentId: agent.id, userId: "usr_evt", messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await createUserAgentAssignment({ externalUserId: "usr_evt", agentId: agent.id });

    const req = buildRequest("POST", {
      event_id: "e1", event_name: "plan_started", external_user_id: "usr_evt",
      occurred_at: new Date().toISOString(),
    }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionEvent).toBe("plan_started");
    expect(updated!.conversionAt).not.toBeNull();
    expect(updated!.reward).toBeGreaterThan(0);

    const arm = await prisma.personaArmStats.findFirst({ where: { agentId: agent.id, variantId: variant.id } });
    expect(arm).not.toBeNull();
    expect(arm!.wins).toBe(1);

    const assignment = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "usr_evt" } });
    expect(assignment!.releasedAt).not.toBeNull();
    expect(assignment!.releaseReason).toBe("conversion");
  });

  it("does not release an assignment owned by a DIFFERENT agent", async () => {
    const persona = await createPersona();
    const agentA = await createAgent({ name: "A" });
    const agentB = await createAgent({ name: "B" });
    const msg = await createMessage(agentA.id);
    const variant = await createVariant(msg.id);
    await createGoal(agentA.id, { eventName: "plan_started", tier: "best", valueWeight: 50 });
    await createUser("usr_evt2", { personaId: persona.id });
    await createUserDecision({
      agentId: agentA.id, userId: "usr_evt2", messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await createUserAgentAssignment({ externalUserId: "usr_evt2", agentId: agentB.id });

    const req = buildRequest("POST", {
      event_id: "e2", event_name: "plan_started", external_user_id: "usr_evt2",
      occurred_at: new Date().toISOString(),
    }, AUTH);
    await POST(req as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "usr_evt2" } });
    expect(assignment!.releasedAt).toBeNull();
  });
});
