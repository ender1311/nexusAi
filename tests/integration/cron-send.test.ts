import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
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

  it("calls Braze /messages/send with external_user_ids", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_1" });
    await createVariant(msg.id);
    await createUser("usr_braze", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const sendCall = brazeRequests.find((r) => r.url.includes("/messages/send"));
    expect(sendCall).toBeTruthy();
    const body = sendCall!.body as Record<string, unknown>;
    expect(body.external_user_ids).toContain("usr_braze");
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
    expect(brazeRequests.filter((r) => r.url.includes("/messages/send"))).toHaveLength(0);
  });

  it("batches users ≤50 per Braze /messages/send call", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
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
    const sendCalls = brazeRequests.filter((r) => r.url.includes("/messages/send"));
    expect(sendCalls).toHaveLength(2); // ceil(55/50) = 2
  });
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
