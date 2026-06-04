// Regression: the send cron must drop push variants missing a title or body
// from the candidate pool, so an incomplete push is never sent while its
// complete siblings still go out and the agent is never blocked.
// Feature: require push title + body (push-completeness gate).
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

let brazeRequests: Array<{ url: string }> = [];
let _originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  brazeRequests = [];

  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      brazeRequests.push({ url });
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

describe("cron skips incomplete push variants", () => {
  it("never selects a titleless push variant, sending the complete sibling instead", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_mix" });
    const complete = await createVariant(msg.id, {
      name: "Complete",
      title: "Has a title",
      body: "Has a body",
      brazeVariantId: "var_complete",
    });
    await createVariant(msg.id, {
      name: "No title",
      title: null,
      body: "Body only",
      brazeVariantId: "var_incomplete",
    });
    await createUser("usr_mix", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_mix" } });
    expect(decisions).toHaveLength(1);
    // The only sendable variant is the complete one — the titleless variant must
    // never be chosen.
    expect(decisions[0].messageVariantId).toBe(complete.id);
  });

  it("sends nothing when the agent's only push variant is incomplete", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" });
    const msg = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_incomplete" });
    await createVariant(msg.id, {
      name: "Titleless",
      title: null,
      body: "Body only",
      brazeVariantId: "var_only_incomplete",
    });
    await createUser("usr_blocked", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(brazeRequests.length).toBe(0);

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_blocked" } });
    expect(decisions).toHaveLength(0);
  });
});
