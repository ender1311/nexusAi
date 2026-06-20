// Integration test: translation loading + VOTD/GP detection applies to all channels in cron.
// Guards the fix that localizeEnabled was gated on push-channel presence — email agents
// with localizePush=true now load translations and route per-language groups correctly.
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

describe("cron localization — all channels", () => {
  it("sends Spanish email copy to es user and English copy to en user when localizePush=true", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ localizePush: true, funnelStage: "wau" });
    const msg = await createMessage(agent.id, {
      channel: "email",
      brazeCampaignId: "camp_email_loc",
    });
    const variant = await createVariant(msg.id, {
      title: "English Subject",
      body: "English Body",
      brazeVariantId: "var_email_loc",
    });
    // Spanish translation
    await createVariantTranslation(variant.id, {
      language: "es",
      title: "Asunto en Español",
      body: "Cuerpo en Español",
      status: "active",
    });

    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Spanish user — should receive Spanish copy
    await createUser("usr_es_email", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "es", newsletter_email_enabled: true },
    });
    // English user — should receive English copy
    await createUser("usr_en_email", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "en", newsletter_email_enabled: true },
    });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(2);

    // Both users should have triggered Braze schedule/create calls
    const sendCalls = brazeRequests.filter((r) =>
      r.url.includes("/messages/schedule/create")
    );
    expect(sendCalls.length).toBeGreaterThanOrEqual(2);

    // Find the call(s) carrying each user
    const esCall = sendCalls.find((r) => {
      const b = r.body as Record<string, unknown>;
      return (b.external_user_ids as string[])?.includes("usr_es_email");
    });
    const enCall = sendCalls.find((r) => {
      const b = r.body as Record<string, unknown>;
      return (b.external_user_ids as string[])?.includes("usr_en_email");
    });

    expect(esCall).toBeTruthy();
    expect(enCall).toBeTruthy();

    // Spanish user's payload must carry Spanish copy
    const esBody = esCall!.body as Record<string, unknown>;
    const esEmail = (esBody.messages as Record<string, unknown>)
      ?.email as Record<string, unknown>;
    expect(esEmail?.subject).toBe("Asunto en Español");
    expect(esEmail?.body).toBe("Cuerpo en Español");

    // English user's payload must carry English copy (the canonical variant)
    const enBody = enCall!.body as Record<string, unknown>;
    const enEmail = (enBody.messages as Record<string, unknown>)
      ?.email as Record<string, unknown>;
    expect(enEmail?.subject).toBe("English Subject");
    expect(enEmail?.body).toBe("English Body");
  });
});
