import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createGoal, createSchedulingRule, createUserDecision,
  linkAgentToPersona,
} from "../helpers/builders";

// This import will FAIL until src/app/api/decide/route.ts is created.
// That is intentional — red test.
import { POST } from "@/app/api/decide/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/decide", () => {
  it("returns 401 without auth", async () => {
    const req = buildRequest("POST", { agentId: "a1", externalUserId: "u1" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when agentId is missing", async () => {
    const req = buildRequest("POST", { externalUserId: "u1" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("returns 404 when agent does not exist", async () => {
    const req = buildRequest("POST", { agentId: "nonexistent", externalUserId: "u1" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(404);
  });

  it("returns 404 when agent is not active", async () => {
    const agent = await createAgent({ status: "draft" });
    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "u1" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(404);
  });

  it("selects a variant and creates a UserDecision", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "A" });
    await createUser("usr_decide", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_decide" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBeFalsy();
    expect(body.data.messageVariantId).toBeTruthy();
    expect(body.data.channel).toBe("push");

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_decide" } });
    expect(decisions).toHaveLength(1);
  });

  it("seeds PersonaArmStats at alpha=1, beta=30 on first decision (pessimistic Beta(1,30) prior)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_seed", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed" }, AUTH);
    await POST(req as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.alpha).toBe(1);
    expect(stats!.beta).toBe(30);
  });

  it("returns suppressed=true when frequency cap is exceeded", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_capped", { personaId: persona.id });
    await createSchedulingRule(agent.id, { frequencyCap: { maxSends: 1, period: "day" } });

    // Create one decision (fills the cap of 1/day)
    await createUserDecision({ agentId: agent.id, userId: "usr_capped" });

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_capped" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBe(true);
    expect(body.data.reason).toBe("frequency_cap");
  });

  it("returns suppressed=true during quiet hours", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_quiet", { personaId: persona.id });
    // Set quiet hours to cover the entire day in UTC
    await createSchedulingRule(agent.id, {
      quietHours: { start: "00:00", end: "23:59", timezone: "UTC" },
    });

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_quiet" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBe(true);
    expect(body.data.reason).toBe("quiet_hours");
  });

  it("falls back to largest active persona when user has no persona", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_nopersona"); // no personaId
    await createPersona({ name: "Small", clusterSize: 1 });
    await createPersona({ name: "Large", clusterSize: 100 }); // should be fallback
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_nopersona" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    // Should succeed (not 404) because fallback persona exists
    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBeFalsy();
  });
});
