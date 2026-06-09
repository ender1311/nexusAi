import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createPersona,
  createUser,
  createMessage,
  createVariant,
  createSchedulingRule,
  linkAgentToPersona,
  createUserSegment,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

let _originalFetch: typeof globalThis.fetch;

async function giveVariant(agentId: string) {
  const m = await createMessage(agentId, { brazeCampaignId: `camp_${agentId}` });
  await createVariant(m.id, { brazeVariantId: `var_${agentId}` });
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET    = "test_cron_secret";
  process.env.BRAZE_API_KEY  = "x";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";

  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
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

describe("continuous enrollment: basic open-enrollment cycle", () => {
  it("enrolls segment members, segment_exit releases leavers, new joiners re-enrolled; cohortAssignedAt stays null", async () => {
    const persona = await createPersona();
    const agent = await prisma.agent.create({
      data: {
        name: "Continuous Agent",
        algorithm: "thompson",
        epsilon: 0.1,
        status: "active",
        funnelStage: "wau",
        enrollmentMode: "continuous",
        segmentTargeting: { includes: ["seg_continuous"], excludes: [] },
      },
    });
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createSchedulingRule(agent.id);

    // Users A and B are in the segment
    await createUser("cont_userA", { personaId: persona.id, funnelStage: "wau" });
    await createUser("cont_userB", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("cont_userA", "seg_continuous");
    await createUserSegment("cont_userB", "seg_continuous");

    // Tick 1: A and B should both be enrolled
    const res1 = await POST(buildRequest("POST", {}, AUTH) as NextRequest);
    expect(res1.status).toBe(200);

    const refreshed1 = await prisma.agent.findUnique({ where: { id: agent.id } });
    // Continuous agents never get cohortAssignedAt stamped
    expect(refreshed1!.cohortAssignedAt).toBeNull();

    const assignA1 = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "cont_userA" } });
    const assignB1 = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "cont_userB" } });
    expect(assignA1).not.toBeNull();
    expect(assignA1!.releasedAt).toBeNull();
    expect(assignA1!.enrollmentFlags).not.toBeNull();
    expect(assignB1).not.toBeNull();
    expect(assignB1!.releasedAt).toBeNull();
    expect(assignB1!.enrollmentFlags).not.toBeNull();

    // Move B out of segment, add C
    await prisma.userSegment.deleteMany({ where: { externalId: "cont_userB", segmentName: "seg_continuous" } });
    await createUser("cont_userC", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("cont_userC", "seg_continuous");

    // Tick 2: B released via segment_exit; C enrolled; A still active
    const res2 = await POST(buildRequest("POST", {}, AUTH) as NextRequest);
    expect(res2.status).toBe(200);

    const assignA2 = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "cont_userA" } });
    const assignB2 = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "cont_userB" } });
    const assignC2 = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: "cont_userC" } });

    // A: still actively enrolled
    expect(assignA2!.releasedAt).toBeNull();

    // B: released with segment_exit
    expect(assignB2!.releasedAt).not.toBeNull();
    expect(assignB2!.releaseReason).toBe("segment_exit");

    // C: newly enrolled
    expect(assignC2).not.toBeNull();
    expect(assignC2!.releasedAt).toBeNull();
    expect(assignC2!.enrollmentFlags).not.toBeNull();

    // cohortAssignedAt still null after tick 2
    const refreshed2 = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(refreshed2!.cohortAssignedAt).toBeNull();
  });
});

describe("continuous enrollment: soft cap honoured and refilled after exit", () => {
  it("cap=2 with 3 members enrolls 2; after one exits third joins on next tick", async () => {
    const persona = await createPersona();
    const agent = await prisma.agent.create({
      data: {
        name: "Capped Continuous",
        algorithm: "thompson",
        epsilon: 0.1,
        status: "active",
        funnelStage: "wau",
        enrollmentMode: "continuous",
        uniqueUsersCap: 2,
        segmentTargeting: { includes: ["seg_cap"], excludes: [] },
      },
    });
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createSchedulingRule(agent.id);

    await createUser("cap_u1", { personaId: persona.id, funnelStage: "wau" });
    await createUser("cap_u2", { personaId: persona.id, funnelStage: "wau" });
    await createUser("cap_u3", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("cap_u1", "seg_cap");
    await createUserSegment("cap_u2", "seg_cap");
    await createUserSegment("cap_u3", "seg_cap");

    // Tick 1: only 2 should be enrolled (cap=2)
    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const activeAfterTick1 = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(activeAfterTick1).toBe(2);

    // cohortAssignedAt must be null (continuous, no freeze)
    const snap1 = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(snap1!.cohortAssignedAt).toBeNull();

    // Identify which two are enrolled, remove one from segment
    const enrolled = await prisma.userAgentAssignment.findMany({
      where: { agentId: agent.id, releasedAt: null },
      select: { externalUserId: true },
    });
    const exitedUser = enrolled[0].externalUserId;
    await prisma.userSegment.deleteMany({ where: { externalId: exitedUser, segmentName: "seg_cap" } });

    // Tick 2: exited user released; third member enrolled (headroom = 1)
    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const exitedAssign = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: exitedUser } });
    expect(exitedAssign!.releaseReason).toBe("segment_exit");

    const activeAfterTick2 = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    // Still 2 active (one released, one new)
    expect(activeAfterTick2).toBe(2);
  });
});

describe("fixed enrollment: cohortAssignedAt still stamped (regression guard)", () => {
  it("fixed agent freezes cohort on first tick and stays frozen", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      name: "Fixed Agent",
      funnelStage: "wau",
      status: "active",
    });
    // enrollmentMode defaults to "fixed"
    await prisma.agent.update({
      where: { id: agent.id },
      data: { uniqueUsersCap: 5, dailySendCap: 100 },
    });
    await linkAgentToPersona(agent.id, persona.id);
    await giveVariant(agent.id);
    await createSchedulingRule(agent.id);

    for (let i = 0; i < 10; i++) {
      await createUser(`fixed_u_${i}`, { personaId: persona.id, funnelStage: "wau" });
    }

    await POST(buildRequest("POST", {}, AUTH) as NextRequest);

    const snap = await prisma.agent.findUnique({ where: { id: agent.id } });
    // Fixed agent MUST have cohortAssignedAt set
    expect(snap!.cohortAssignedAt).not.toBeNull();

    const count = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(count).toBe(5);
  });
});
