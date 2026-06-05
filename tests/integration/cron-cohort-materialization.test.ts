import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createPersona,
  createUser,
  createUserAgentAssignment,
  linkAgentToPersona,
  createMessage,
  createVariant,
  createSchedulingRule,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

// Intercept Braze HTTP calls so sends succeed without a real Braze account.
// Mirrors the harness in cron-lottery-ownership.test.ts.
let _originalFetch: typeof globalThis.fetch;

async function giveVariant(agentId: string) {
  const m = await createMessage(agentId, { brazeCampaignId: `camp_${agentId}` });
  await createVariant(m.id, { brazeVariantId: `var_${agentId}` });
}

// createAgent doesn't expose uniqueUsersCap/dailySendCap, so set them directly.
async function setCaps(agentId: string, uniqueUsersCap: number, dailySendCap: number) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { uniqueUsersCap, dailySendCap },
  });
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "x";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";

  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return _originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = _originalFetch;
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
});

describe("cron cohort materialization", () => {
  it("materializes exactly uniqueUsersCap assignments + locks on the first run", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Cohort", funnelStage: "lapsed_wau", status: "active" });
    await setCaps(agent.id, 20, 500);
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createSchedulingRule(agent.id);

    // ~50 eligible users: matching persona + funnelStage, push-enabled, en, unlocked,
    // no active assignment (createUser defaults give push/en/confidence 1.0).
    for (let i = 0; i < 50; i++) {
      await createUser(`cohort_u_${i}`, { personaId: persona.id, funnelStage: "lapsed_wau" });
    }

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const refreshed = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(refreshed!.cohortAssignedAt).not.toBeNull();

    const assignmentCount = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(assignmentCount).toBe(20);

    const lockedCount = await prisma.trackedUser.count({
      where: { lockedByAgentId: agent.id },
    });
    expect(lockedCount).toBe(20);
  });

  it("does not re-materialize on a second run", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Cohort", funnelStage: "lapsed_wau", status: "active" });
    await setCaps(agent.id, 20, 500);
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createSchedulingRule(agent.id);

    for (let i = 0; i < 50; i++) {
      await createUser(`cohort_u_${i}`, { personaId: persona.id, funnelStage: "lapsed_wau" });
    }

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);
    const afterFirst = await prisma.agent.findUnique({ where: { id: agent.id } });
    const firstStamp = afterFirst!.cohortAssignedAt;
    expect(firstStamp).not.toBeNull();
    const firstCount = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(firstCount).toBe(20);

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);
    const afterSecond = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(afterSecond!.cohortAssignedAt!.getTime()).toBe(firstStamp!.getTime());
    const secondCount = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(secondCount).toBe(20);
  });

  it("stops recruiting after materialization", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Cohort", funnelStage: "lapsed_wau", status: "active" });
    await setCaps(agent.id, 20, 500);
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createSchedulingRule(agent.id);

    // Exactly 20 eligible users → materialize the full cohort.
    for (let i = 0; i < 20; i++) {
      await createUser(`cohort_u_${i}`, { personaId: persona.id, funnelStage: "lapsed_wau" });
    }

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);
    const afterFirst = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(afterFirst).toBe(20);

    // Add 30 MORE eligible unlocked users in the same funnelStage/persona.
    for (let i = 0; i < 30; i++) {
      await createUser(`recruit_u_${i}`, { personaId: persona.id, funnelStage: "lapsed_wau" });
    }

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    // A materialized agent only queries its own locked cohort — no new recruits.
    const afterSecond = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(afterSecond).toBe(20);

    const newlyLocked = await prisma.trackedUser.count({
      where: { externalId: { startsWith: "recruit_u_" }, lockedByAgentId: { not: null } },
    });
    expect(newlyLocked).toBe(0);
  });

  it("skips users already locked/owned by another agent", async () => {
    const persona = await createPersona();

    // A different agent already owns + locks userA.
    const otherAgent = await createAgent({ name: "Other", funnelStage: "lapsed_wau", status: "active" });
    await setCaps(otherAgent.id, 20, 500);
    await linkAgentToPersona(otherAgent.id, persona.id);
    await giveVariant(otherAgent.id);
    await createSchedulingRule(otherAgent.id);
    // Pre-stamp otherAgent as already materialized so it doesn't re-recruit this run.
    await prisma.agent.update({ where: { id: otherAgent.id }, data: { cohortAssignedAt: new Date() } });

    await createUser("userA", { personaId: persona.id, funnelStage: "lapsed_wau" });
    await prisma.trackedUser.update({ where: { externalId: "userA" }, data: { lockedByAgentId: otherAgent.id } });
    await createUserAgentAssignment({ externalUserId: "userA", agentId: otherAgent.id });

    // Our agent: cap 20, eligible set would include userA + 25 others.
    const ourAgent = await createAgent({ name: "Ours", funnelStage: "lapsed_wau", status: "active" });
    await setCaps(ourAgent.id, 20, 500);
    await linkAgentToPersona(ourAgent.id, persona.id);
    await giveVariant(ourAgent.id);
    await createSchedulingRule(ourAgent.id);

    for (let i = 0; i < 25; i++) {
      await createUser(`other_u_${i}`, { personaId: persona.id, funnelStage: "lapsed_wau" });
    }

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const ourAssignments = await prisma.userAgentAssignment.findMany({
      where: { agentId: ourAgent.id, releasedAt: null },
      select: { externalUserId: true },
    });
    const ourCohort = ourAssignments.map((a) => a.externalUserId);
    expect(ourCohort).not.toContain("userA");
  });
});
