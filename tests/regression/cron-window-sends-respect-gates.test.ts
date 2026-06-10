// Regression (2026-06-09 audit, I5): in-window (Phase 0 exploration) sends must
// apply the same eligibility gate chain as the lottery path. Before the fix the
// in-window sub-pool only checked freq cap / daily cap / timing, so a user who
// opted out of push (or stopped matching the agent's targetFilter) mid-window
// kept receiving pushes for the remaining ~8 days of the window.
// Guards the quietWindowUsers filter in src/app/api/cron/select-and-send/route.ts.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
  createUserAgentAssignment,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let brazeRequests: Array<{ url: string; body: unknown }> = [];
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
      brazeRequests.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
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

describe("regression: in-window sends respect eligibility gates", () => {
  it("push-opted-out in-window user gets no send; eligible in-window user still does", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "lapsed" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_i5" });
    await createVariant(msg.id, { brazeVariantId: "var_i5" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Both users are mid-window (active assignment, sendCount < 4).
    await createUser("usr_i5_opted_out", {
      personaId: persona.id,
      funnelStage: "lapsed",
      attributes: { newsletter_push_enabled: false },
    });
    await createUser("usr_i5_ok", { personaId: persona.id, funnelStage: "lapsed" });
    await createUserAgentAssignment({ externalUserId: "usr_i5_opted_out", agentId: agent.id, sendCount: 1 });
    await createUserAgentAssignment({ externalUserId: "usr_i5_ok", agentId: agent.id, sendCount: 1 });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const optedOut = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_i5_opted_out" },
    });
    const ok = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_i5_ok" },
    });
    expect(optedOut!.sendCount).toBe(1); // suppressed — no in-window send
    expect(ok!.sendCount).toBe(2);       // control — the window path still sends

    const sentIds = brazeRequests.flatMap((r) => {
      const b = r.body as { messages?: unknown; external_user_ids?: string[] } | null;
      return b?.external_user_ids ?? [];
    });
    expect(sentIds).not.toContain("usr_i5_opted_out");
  });

  it("in-window user no longer matching the agent targetFilter gets no send", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "lapsed",
      targetFilter: { country_latest: "US" },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_i5_tf" });
    await createVariant(msg.id, { brazeVariantId: "var_i5_tf" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await createUser("usr_i5_filter_out", {
      personaId: persona.id,
      funnelStage: "lapsed",
      attributes: { country_latest: "BR" },
    });
    await createUserAgentAssignment({ externalUserId: "usr_i5_filter_out", agentId: agent.id, sendCount: 1 });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_i5_filter_out" },
    });
    expect(assignment!.sendCount).toBe(1);
  });
});
