import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
  createUserDecision,
  createUserAgentAssignment,   // ← add this
} from "../helpers/builders";

// This import will FAIL until the route is created — intentional RED test.
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

// Track Braze HTTP calls
let brazeRequests: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET   = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  brazeRequests = [];

  // Replace globalThis.fetch to intercept Braze HTTP calls
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    brazeRequests.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return new Response(JSON.stringify({ message: "success" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
  // Restore fetch
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("POST /api/cron/select-and-send", () => {
  it("returns 401 without CRON_SECRET", async () => {
    const req = buildRequest("POST");
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const req = buildRequest("POST", undefined, { Authorization: "Bearer wrong" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 500 when Braze not configured", async () => {
    delete process.env.BRAZE_API_KEY;
    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(500);
  });

  it("returns ok:true and sent count for eligible user", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_123" });
    await createVariant(msg.id, { brazeVariantId: "var_abc" });
    await createUser("usr_cron", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(1);
    expect(body.suppressed).toBe(0);
  });

  it("calls Braze /messages/schedule/create with external_user_ids and schedule.time", async () => {
    // All sends now route to /messages/schedule/create (per-user timing via computeScheduledAt)
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_1" });
    await createVariant(msg.id);
    await createUser("usr_braze", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const sendCall = brazeRequests.find((r) => r.url.includes("/messages/schedule/create"));
    expect(sendCall).toBeTruthy();
    const body = sendCall!.body as Record<string, unknown>;
    expect(body.external_user_ids).toContain("usr_braze");
    expect((body.schedule as Record<string, unknown>)?.time).toBeTruthy();
  });

  it("records brazeSendId on UserDecision after successful send", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_2" });
    await createVariant(msg.id);
    await createUser("usr_sid", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr_sid" } });
    // brazeSendId is set when campaign has a brazeCampaignId
    expect(decision?.brazeSendId).toBeTruthy();
  });

  it("skips suppressed users (frequency cap exceeded)", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_sup", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id, { frequencyCap: { maxSends: 0, period: "day" } });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.suppressed).toBeGreaterThanOrEqual(1);
    expect(brazeRequests.filter((r) => r.url.includes("/messages/schedule/create"))).toHaveLength(0);
  });

  it("batches users ≤50 per Braze /messages/schedule/create call", async () => {
    const persona = await createPersona();
    // Use "engaged" so users go through the lottery path (not Phase 0 exploration window)
    const agent = await createAgent({ funnelStage: "engaged" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_batch" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Create 55 users — should result in 2 Braze send calls (50 + 5)
    for (let i = 0; i < 55; i++) {
      await createUser(`usr_batch_${i}`, { personaId: persona.id });
    }

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.sent).toBe(55);
    const sendCalls = brazeRequests.filter((r) => r.url.includes("/messages/schedule/create"));
    expect(sendCalls).toHaveLength(2); // ceil(55/50) = 2; all users share fallback scheduledAt → one group
  }, 20000); // 55 users × sequential DB ops against Neon
});

describe("Lottery: cross-agent user distribution", () => {
  it("user shared by two agents receives exactly one send", async () => {
    const persona  = await createPersona();
    const agentA   = await createAgent({ name: "Agent A" });
    const agentB   = await createAgent({ name: "Agent B" });
    const msgA     = await createMessage(agentA.id, { brazeCampaignId: "camp_A" });
    const msgB     = await createMessage(agentB.id, { brazeCampaignId: "camp_B" });
    await createVariant(msgA.id, { brazeVariantId: "var_A" });
    await createVariant(msgB.id, { brazeVariantId: "var_B" });
    await createUser("usr_shared", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(body.ok).toBe(true);

    const decisions = await prisma.userDecision.findMany({
      where: { userId: "usr_shared" },
    });
    expect(decisions).toHaveLength(1);  // exactly one send
  });

  it("users with disjoint personas each receive one send from their respective agent", async () => {
    const personaA = await createPersona({ name: "Persona A" });
    const personaB = await createPersona({ name: "Persona B" });
    const agentA   = await createAgent({ name: "Agent A" });
    const agentB   = await createAgent({ name: "Agent B" });
    const msgA     = await createMessage(agentA.id, { brazeCampaignId: "camp_A2" });
    const msgB     = await createMessage(agentB.id, { brazeCampaignId: "camp_B2" });
    await createVariant(msgA.id);
    await createVariant(msgB.id);
    await createUser("usr_only_A", { personaId: personaA.id });
    await createUser("usr_only_B", { personaId: personaB.id });
    await linkAgentToPersona(agentA.id, personaA.id);
    await linkAgentToPersona(agentB.id, personaB.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisionsA = await prisma.userDecision.findMany({ where: { userId: "usr_only_A" } });
    const decisionsB = await prisma.userDecision.findMany({ where: { userId: "usr_only_B" } });
    expect(decisionsA).toHaveLength(1);
    expect(decisionsB).toHaveLength(1);
    expect(decisionsA[0].agentId).toBe(agentA.id);
    expect(decisionsB[0].agentId).toBe(agentB.id);
  });
});

describe("Global daily cap", () => {
  it("second cron run on the same day sends to zero users", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_dailycap" });
    await createVariant(msg.id);
    await createUser("usr_capped", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // First run — should send
    const res1  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body1 = await res1.json();
    expect(body1.sent).toBe(1);

    // Second run — same calendar day, global cap should block
    const res2  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.sent).toBe(0);
    expect(body2.suppressed).toBeGreaterThanOrEqual(1);
  });

  it("user sent yesterday is eligible again today", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_yesterday" });
    await createVariant(msg.id);
    await createUser("usr_yesterday", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Seed a UserDecision from 2 days ago (definitely before today's midnight ET)
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await createUserDecision({
      agentId: agent.id,
      userId:  "usr_yesterday",
      sentAt:  twoDaysAgo,
    });

    // Cron run today — user should NOT be capped
    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();
    expect(body.sent).toBe(1);
  });

  it("cross-agent: user sent by agentA today is suppressed when agentB tries to send", async () => {
    const persona  = await createPersona();
    const agentA   = await createAgent({ name: "Agent A" });
    const agentB   = await createAgent({ name: "Agent B" });
    const msgA     = await createMessage(agentA.id);
    const msgB     = await createMessage(agentB.id);
    await createVariant(msgA.id);
    await createVariant(msgB.id);
    const user     = await createUser("usr_cross_cap", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    // Pre-seed a decision from agentA today (before this cron run)
    await createUserDecision({
      agentId: agentA.id,
      userId:  user.externalId,
      sentAt:  new Date(),
    });

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    const decisions = await prisma.userDecision.findMany({
      where: { userId: user.externalId },
    });
    // Still 1 (the pre-seeded one) — cron did not add a second
    expect(decisions).toHaveLength(1);
    expect(body.suppressed).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase 0: exploration window assignment", () => {
  it("creates an assignment for a lapsed-funnel user with no prior assignment", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_phase0" });
    await createVariant(msg.id);
    await createUser("usr_new_lapsed", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_new_lapsed" },
    });
    expect(assignment).not.toBeNull();
    expect(assignment!.agentId).toBe(agent.id);
    expect(assignment!.windowCompletedAt).toBeNull();
  });

  it("creates an assignment for a connected-funnel user", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "connected" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_connected", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_connected" },
    });
    expect(assignment).not.toBeNull();
  });

  it("does NOT create an assignment for an engaged-funnel user (not lapsed/connected)", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "engaged" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_engaged", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_engaged" },
    });
    expect(assignment).toBeNull();
  });

  it("does not reassign a user whose window is still active", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_in_window", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId: user.externalId,
      agentId:        agent.id,
      sendCount:      1,
      startedAt:      twoDaysAgo,
      windowCompletedAt: null,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    // Still the same assignment — startedAt not reset
    expect(assignment!.startedAt.getTime()).toBeCloseTo(twoDaysAgo.getTime(), -3);
  });

  it("does not reassign during cooldown period (default 90 days)", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_cooldown", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId:   user.externalId,
      agentId:          agent.id,
      sendCount:        4,
      windowCompletedAt: tenDaysAgo,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    // windowCompletedAt unchanged
    expect(assignment!.windowCompletedAt!.getTime()).toBeCloseTo(tenDaysAgo.getTime(), -3);
    expect(assignment!.sendCount).toBe(4);
  });

  it("triggers a new window when cooldown has expired", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_expired_cooldown", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId:   user.externalId,
      agentId:          agent.id,
      sendCount:        4,
      windowCompletedAt: ninetyOneDaysAgo,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    // Window reset
    expect(assignment!.windowCompletedAt).toBeNull();
    expect(assignment!.sendCount).toBeGreaterThanOrEqual(0);
  });

  it("closes an expired window (8 days elapsed, sendCount < 4) without triggering new sends", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_stale_window", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const nineDaysAgo = new Date(Date.now() - 9 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId:   user.externalId,
      agentId:          agent.id,
      sendCount:        2,
      startedAt:        nineDaysAgo,
      windowCompletedAt: null,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    expect(assignment!.windowCompletedAt).not.toBeNull();  // closed by cron
    expect(assignment!.sendCount).toBe(2);                 // no new sends added
  });

  it("in-window user goes to their assigned agent and sendCount increments", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_window" });
    await createVariant(msg.id, { brazeVariantId: "var_w1" });
    await createUser("usr_window_send", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);
    await createUserAgentAssignment({
      externalUserId: "usr_window_send",
      agentId:        agent.id,
      sendCount:      0,
    });

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.sent).toBeGreaterThanOrEqual(1);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_window_send" },
    });
    expect(assignment!.sendCount).toBe(1);
    expect(assignment!.windowCompletedAt).toBeNull(); // only 1 of 4 sends done
  });

  it("sets windowCompletedAt when sendCount reaches 4", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_complete" });
    await createVariant(msg.id);
    await createUser("usr_completing", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);
    await createUserAgentAssignment({
      externalUserId: "usr_completing",
      agentId:        agent.id,
      sendCount:      3,   // one more send will complete the window
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_completing" },
    });
    expect(assignment!.sendCount).toBe(4);
    expect(assignment!.windowCompletedAt).not.toBeNull();
  }, 15000);

  it("in-window user is excluded from normal (lottery) user pipeline", async () => {
    const persona     = await createPersona();
    const agentA      = await createAgent({ funnelStage: "lapsed",     name: "Agent A" });
    const agentB      = await createAgent({ funnelStage: "connected",  name: "Agent B" });
    const msgA        = await createMessage(agentA.id, { brazeCampaignId: "camp_a" });
    const msgB        = await createMessage(agentB.id, { brazeCampaignId: "camp_b" });
    await createVariant(msgA.id, { brazeVariantId: "var_a" });
    await createVariant(msgB.id, { brazeVariantId: "var_b" });
    await createUser("usr_exclusive", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    // Lock user to agentA
    await createUserAgentAssignment({
      externalUserId: "usr_exclusive",
      agentId:        agentA.id,
      sendCount:      0,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisions = await prisma.userDecision.findMany({
      where: { userId: "usr_exclusive" },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].agentId).toBe(agentA.id);
  });
});
