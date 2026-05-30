// Regression: cron select-and-send never enforced rule.blackoutDates, so sends were
// scheduled on agent-configured no-send dates (e.g. a Saturday delivery despite that
// date being a global blackout). The fix gates both send paths on isBlackoutDate(),
// checking the scheduledAt UTC anchor (which catches fallback sends rolled forward to
// the next UTC day).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
} from "../helpers/builders";

import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let brazeRequests: Array<{ url: string; method: string; body: unknown }> = [];
let _originalFetch: typeof globalThis.fetch;

// Fallback sends land on today's fallbackSendHour UTC, or roll forward to tomorrow if that
// hour has already passed. Blacking out both UTC days guarantees suppression regardless of
// when this test runs.
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
const TODAY = ymd(new Date());
const TOMORROW = ymd(new Date(Date.now() + 24 * 60 * 60 * 1000));

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET   = "test_cron_secret";
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
  globalThis.fetch = _originalFetch;
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
});

describe("cron blackout-date enforcement", () => {
  it("suppresses a send that would land on a blackout date", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_blk" });
    await createVariant(msg.id, { brazeVariantId: "var_blk" });
    await createUser("usr_blackout", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id, { blackoutDates: [TODAY, TOMORROW] });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.suppressed).toBeGreaterThanOrEqual(1);
    // No Braze schedule call should have been made for the blacked-out send.
    expect(brazeRequests.filter((r) => r.url.includes("/messages/schedule/create")).length).toBe(0);
  });

  it("sends normally when no blackout dates are configured (control)", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_ok" });
    await createVariant(msg.id, { brazeVariantId: "var_ok" });
    await createUser("usr_ok", { personaId: persona.id, funnelStage: "wau" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id, { blackoutDates: [] });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.suppressed).toBe(0);
  });
});
