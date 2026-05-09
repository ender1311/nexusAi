/**
 * Regression tests: Global daily send-ID budget enforcement (DAILY_SEND_ID_LIMIT = 800)
 *
 * These tests guard against regressions where:
 * 1. The cron job creates more than 800 distinct Braze send IDs in a single day
 * 2. Orphaned UserDecisions (created before budget exhaustion) survive budget cap
 * 3. The budgetExhausted flag is not returned when the budget is already at 0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createPersona,
  createMessage,
  createVariant,
  createUser,
  createSchedulingRule,
  linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let brazeRequests: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET    = "test_cron_secret";
  process.env.BRAZE_API_KEY  = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  brazeRequests = [];

  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    brazeRequests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : null });
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
  delete (globalThis as Record<string, unknown>).fetch;
});

// ─── Regression: budget already exhausted before cron runs ───────────────────

describe("send-ID budget: already exhausted at cron start", () => {
  it("returns budgetExhausted=true and sent=0 when 800 send IDs are already used today", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_budget" });
    const variant = await createVariant(msg.id);
    await createUser("usr_budget", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Pre-seed 800 distinct brazeSendId values for today so the budget is at 0
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dummyUsers = await Promise.all(
      Array.from({ length: 800 }, (_, i) => prisma.trackedUser.create({
        data: { externalId: `budget_fill_${i}`, funnelStage: "wau" },
      }))
    );
    await prisma.userDecision.createMany({
      data: dummyUsers.map((u, i) => ({
        agentId: agent.id,
        userId: u.externalId,
        channel: "push",
        messageVariantId: variant.id,
        sentAt: new Date(),
        brazeSendId: `fill_send_${i}`,
      })),
    });

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(0);
    expect(body.budgetExhausted).toBe(true);

    // Verify no Braze send calls were made
    const sendCalls = brazeRequests.filter((r) => r.url.includes("/messages/"));
    expect(sendCalls).toHaveLength(0);
  }, 30000);
});

// ─── Regression: orphaned decisions must be cleaned up when budget is hit ─────

describe("send-ID budget: orphaned decision cleanup", () => {
  it("deletes UserDecisions created for tasks that exceed the budget", async () => {
    // Set up 2 agents competing for 1 send-ID slot
    // Agent A gets the slot; Agent B's pre-created decisions must be deleted.
    const persona = await createPersona();
    const agentA  = await createAgent({ name: "Agent A" });
    const agentB  = await createAgent({ name: "Agent B" });
    const msgA = await createMessage(agentA.id, { brazeCampaignId: "camp_a_orphan" });
    const msgB = await createMessage(agentB.id, { brazeCampaignId: "camp_b_orphan" });
    await createVariant(msgA.id);
    await createVariant(msgB.id);
    const userA = await createUser("usr_orphan_a", { personaId: persona.id });
    const userB = await createUser("usr_orphan_b", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    // Fill 799 send IDs so only 1 slot remains after this cron run starts
    const fillUsers = await Promise.all(
      Array.from({ length: 799 }, (_, i) => prisma.trackedUser.create({
        data: { externalId: `orphan_fill_${i}`, funnelStage: "wau" },
      }))
    );
    await prisma.userDecision.createMany({
      data: fillUsers.map((u, i) => ({
        agentId: agentA.id,
        userId: u.externalId,
        channel: "push",
        sentAt: new Date(),
        brazeSendId: `fill_${i}`,
      })),
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    // Total UserDecisions for the orphan users should be at most 1 (the one that fit in budget)
    const decisions = await prisma.userDecision.findMany({
      where: { userId: { in: [userA.externalId, userB.externalId] } },
    });
    // The cron should not have left orphaned records for both users — at most 1 send
    expect(decisions.length).toBeLessThanOrEqual(1);
  }, 30000);
});

// ─── Regression: budget response fields are always present ───────────────────

describe("send-ID budget: response shape", () => {
  it("response always includes sendIdBudgetUsed and sendIdBudgetRemaining", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_shape" });
    await createVariant(msg.id);
    await createUser("usr_shape", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(typeof body.sendIdBudgetUsed).toBe("number");
    expect(typeof body.sendIdBudgetRemaining).toBe("number");
    expect(body.sendIdBudgetUsed + body.sendIdBudgetRemaining).toBeLessThanOrEqual(800);
  });

  it("sendIdBudgetRemaining decreases by 1 for each user sent to", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_remaining" });
    await createVariant(msg.id);
    await createUser("usr_remaining", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    // 1 user was sent to = 1 send ID consumed
    expect(body.sendIdBudgetUsed).toBe(1);
    expect(body.sendIdBudgetRemaining).toBe(799);
  });
});
