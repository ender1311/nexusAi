// Integration test: for localized agents (localizePush=true), recruitment must
// restrict the in-memory language filter to only languages the agent can serve
// (en + languages present in MessageVariantTranslation rows).
//
// Without this fix, a user whose language_tag has no matching translation is
// recruited, processed, and then strict-skipped at send time — silently burning
// quota without sending anything.  With the fix, such users are filtered out
// before variant selection.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createPersona,
  createMessage,
  createVariant,
  createVariantTranslation,
  createUser,
  createSchedulingRule,
  linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let brazeRequests: Array<{ url: string; method: string; body: unknown }> = [];
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
    init?: RequestInit,
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

describe("cron localized-agent recruitment — servable languages only", () => {
  it("sends to es and en users but NOT to fr user when only es translation exists", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ localizePush: true, funnelStage: "wau" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_loc" });
    const variant = await createVariant(msg.id, {
      title: "English Title",
      body: "English Body",
      brazeVariantId: "var_loc",
    });
    // Only es translation — fr user should be filtered out
    await createVariantTranslation(variant.id, {
      language: "es",
      title: "Título en Español",
      body: "Cuerpo en Español",
      status: "active",
    });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await createUser("usr_en_loc", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "en" },
    });
    await createUser("usr_es_loc", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "es" },
    });
    // French user — no fr translation → should be excluded at recruitment time
    await createUser("usr_fr_loc", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "fr" },
    });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json() as { sent: number; suppressed: number };

    expect(res.status).toBe(200);
    // Only en + es users should be sent to (2 sends)
    expect(body.sent).toBe(2);

    // Confirm fr user was never included in a Braze request
    const allSentIds = brazeRequests.flatMap((r) => {
      const b = r.body as Record<string, unknown>;
      return (b.external_user_ids as string[] | undefined) ?? [];
    });
    expect(allSentIds).toContain("usr_en_loc");
    expect(allSentIds).toContain("usr_es_loc");
    expect(allSentIds).not.toContain("usr_fr_loc");
  });

  it("non-localized agent (localizePush=false) still only sends to en users by default", async () => {
    const persona = await createPersona();
    // localizePush=false → default en-only behaviour unchanged
    const agent = await createAgent({ localizePush: false, funnelStage: "wau" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_nonloc" });
    await createVariant(msg.id, { title: "Title", body: "Body", brazeVariantId: "var_nonloc" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await createUser("usr_en_nonloc", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "en" },
    });
    await createUser("usr_es_nonloc", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "es" },
    });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json() as { sent: number };
    expect(res.status).toBe(200);
    // Only English user sent — es filtered by default en-only
    expect(body.sent).toBe(1);
    const allSentIds = brazeRequests.flatMap((r) => {
      const b = r.body as Record<string, unknown>;
      return (b.external_user_ids as string[] | undefined) ?? [];
    });
    expect(allSentIds).toContain("usr_en_nonloc");
    expect(allSentIds).not.toContain("usr_es_nonloc");
  });
});
