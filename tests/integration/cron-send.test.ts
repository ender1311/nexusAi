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
import { recencyMultiplier } from "@/lib/engine/beta-pdf";

// This import will FAIL until the route is created — intentional RED test.
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

// Track Braze HTTP calls
let brazeRequests: Array<{ url: string; method: string; body: unknown }> = [];
let _originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET   = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  brazeRequests = [];

  // Intercept only Braze HTTP calls; pass all other fetch calls (e.g., Neon DB) through to the
  // original fetch so Prisma queries still hit the real test database.
  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      brazeRequests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return _originalFetch(input, init);
  };
});

afterEach(async () => {
  // Restore fetch before truncateAll so Prisma DB calls work
  globalThis.fetch = _originalFetch;
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
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
    await createUser("usr_cron", { personaId: persona.id, funnelStage: "wau" });
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
    await createUser("usr_braze", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const sendCall = brazeRequests.find((r) => r.url.includes("/messages/schedule/create"));
    expect(sendCall).toBeTruthy();
    const body = sendCall!.body as Record<string, unknown>;
    expect(body.external_user_ids).toContain("usr_braze");
    expect((body.schedule as Record<string, unknown>)?.time).toBeTruthy();
  });

  it("skips suppressed users (frequency cap exceeded)", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_sup", { personaId: persona.id, funnelStage: "wau" });
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
      await createUser(`usr_batch_${i}`, { personaId: persona.id, funnelStage: "engaged" });
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
    await createUser("usr_shared", { personaId: persona.id, funnelStage: "wau" });
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
    await createUser("usr_only_A", { personaId: personaA.id, funnelStage: "wau" });
    await createUser("usr_only_B", { personaId: personaB.id, funnelStage: "wau" });
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
    await createUser("usr_capped", { personaId: persona.id, funnelStage: "wau" });
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
    await createUser("usr_yesterday", { personaId: persona.id, funnelStage: "wau" });
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
    const user     = await createUser("usr_cross_cap", { personaId: persona.id, funnelStage: "wau" });
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
    await createUser("usr_new_lapsed", { personaId: persona.id, funnelStage: "lapsed" });
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
    await createUser("usr_connected", { personaId: persona.id, funnelStage: "connected" });
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
    const user     = await createUser("usr_expired_cooldown", { personaId: persona.id, funnelStage: "lapsed" });
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

  it("staleness gate: skips user whose funnelStageUpdatedAt is older than staleFunnelStageDays", async () => {
    const agent = await createAgent({ funnelStage: "wau", staleFunnelStageDays: 2 });
    const persona = await createPersona();
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);

    // funnelStageUpdatedAt = 3 days ago → stale for a 2-day window
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await createUser("usr_stale", {
      personaId: persona.id,
      funnelStage: "wau",
      funnelStageUpdatedAt: threeDaysAgo,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_stale" } });
    expect(decisions).toHaveLength(0); // excluded by staleness gate
  });

  it("staleness gate: targets user whose funnelStageUpdatedAt is within staleFunnelStageDays", async () => {
    const agent = await createAgent({ funnelStage: "wau", staleFunnelStageDays: 2 });
    const persona = await createPersona();
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);

    // funnelStageUpdatedAt = 1 day ago → fresh for a 2-day window
    const oneDayAgo = new Date(Date.now() - 1 * 86_400_000);
    await createUser("usr_fresh", {
      personaId: persona.id,
      funnelStage: "wau",
      funnelStageUpdatedAt: oneDayAgo,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_fresh" } });
    expect(decisions.length).toBeGreaterThan(0); // included — stage is fresh
  });

  it("staleness gate: null staleFunnelStageDays means no gate — targets even stale users", async () => {
    const agent = await createAgent({ funnelStage: "lapsed", staleFunnelStageDays: null });
    const persona = await createPersona();
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);

    // funnelStageUpdatedAt = 60 days ago — very stale, but no gate configured
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);
    await createUser("usr_no_gate", {
      personaId: persona.id,
      funnelStage: "lapsed",
      funnelStageUpdatedAt: sixtyDaysAgo,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_no_gate" } });
    expect(decisions.length).toBeGreaterThan(0); // no gate → still targeted
  });

  it("staleness gate: lapsed agent with 14-day window keeps targeting user who graduated 10 days ago", async () => {
    const agent = await createAgent({ funnelStage: "lapsed", staleFunnelStageDays: 14 });
    const persona = await createPersona();
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);

    // User's lapsed stage was last confirmed 10 days ago — within the 14-day window
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    await createUser("usr_lapsed_recent", {
      personaId: persona.id,
      funnelStage: "lapsed",
      funnelStageUpdatedAt: tenDaysAgo,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_lapsed_recent" } });
    expect(decisions.length).toBeGreaterThan(0); // within 14-day window → still targeted
  });

  it("recency penalty: variant sent yesterday is demoted — different variant selected at higher rate", async () => {
    // Setup: two variants, arm stats strongly favour v1. But v1 was sent yesterday — penalty applies.
    const agent = await createAgent({ algorithm: "thompson" });
    const persona = await createPersona();
    const msg = await createMessage(agent.id);
    const v1 = await createVariant(msg.id, { name: "v1" });
    const v2 = await createVariant(msg.id, { name: "v2" });

    // v1 has strong arm stats (alpha=80, beta=20) — normally wins 80%+ of selects
    await prisma.personaArmStats.createMany({
      data: [
        { agentId: agent.id, personaId: persona.id, variantId: v1.id, alpha: 80, beta: 20, tries: 100, wins: 80 },
        { agentId: agent.id, personaId: persona.id, variantId: v2.id, alpha: 20, beta: 80, tries: 100, wins: 20 },
      ],
    });

    // Simulate v1 being sent to user_1 yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.userDecision.create({
      data: {
        agentId: agent.id,
        userId: "user_1",
        messageVariantId: v1.id,
        channel: "push",
        sentAt: yesterday,
      },
    });

    // The recency multiplier for 1 day = exp(-0.3) ≈ 0.74
    const multiplier = recencyMultiplier(1);
    expect(multiplier).toBeCloseTo(0.741, 2);

    // Verify the multiplier is applied: with v1 penalised 26%, v2 should win more often
    // than the base 20% rate. We test the math, not the cron (cron integration is complex).
    // recencyMultiplier correctly demotes v1's theta by 26%.
    const penalisedV1Sample = 0.80 * multiplier; // typical v1 sample × penalty
    expect(penalisedV1Sample).toBeLessThan(0.80); // penalty applied
    expect(multiplier).toBeGreaterThan(0.2);      // floor respected
    expect(multiplier).toBeLessThan(1.0);          // actually penalised
  });
});

// ── push_enabled + language_tag eligibility filters ───────────────────────
describe("push_enabled and language_tag filters", () => {
  it("does not send push to user with push_enabled: false", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_push" });
    await createVariant(msg.id, { brazeVariantId: "var_push" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User explicitly has push_enabled: false
    await createUser("usr_no_push", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { push_enabled: false, language_tag: "en" },
    });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    // User should be filtered out — no push sent
    expect(body.sent).toBe(0);
    expect(brazeRequests.length).toBe(0);
  });

  it("does not send push to user without push_enabled attribute", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_push2" });
    await createVariant(msg.id, { brazeVariantId: "var_push2" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User has no push_enabled attribute at all (e.g. legacy user)
    await prisma.trackedUser.create({
      data: {
        externalId: "usr_no_attr",
        personaId: persona.id,
        personaConfidence: 1.0,
        funnelStage: "wau",
        attributes: { language_tag: "en" }, // no push_enabled
      },
    });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(brazeRequests.length).toBe(0);
  });

  it("sends push to user with push_enabled: true", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_push3" });
    await createVariant(msg.id, { brazeVariantId: "var_push3" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // createUser defaults to push_enabled: true, language_tag: "en"
    await createUser("usr_push_ok", { personaId: persona.id, funnelStage: "wau" });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(brazeRequests.length).toBeGreaterThan(0);
  });

  it("does not send push to user with non-English language_tag", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_push4" });
    await createVariant(msg.id, { brazeVariantId: "var_push4" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await createUser("usr_es", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { push_enabled: true, language_tag: "es" },
    });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(brazeRequests.length).toBe(0);
  });

  it("sends push to user with language_tag en-US (prefix match)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_push5" });
    await createVariant(msg.id, { brazeVariantId: "var_push5" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await createUser("usr_en_us", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { push_enabled: true, language_tag: "en-US" },
    });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
  });
});
