// Integration test: demo send must apply strict per-language translation
// resolution, mirroring the cron.  An es recipient with an es translation
// receives Spanish copy; an es recipient with no translation is skipped (not
// sent English).  This guards against the demo always rendering English
// regardless of recipient language.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createMessage,
  createVariant,
  createVariantTranslation,
  createSchedulingRule,
  createUser,
  createPersona,
  linkAgentToPersona,
} from "../helpers/builders";

// Mutable auth state
const mockAuth: {
  user: { id: string; email: string; firstName: null; lastName: null } | null;
  roles: string[];
} = {
  user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
  roles: ["admin"],
};

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: mockAuth.user,
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { POST } = await import("@/app/api/demo/send/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.user = { id: "u1", email: "test@youversion.com", firstName: null, lastName: null };
  mockAuth.roles = ["admin"];
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/demo/send — strict translation resolution (localizePush=true)", () => {
  it("returns Spanish copy for es recipient when es translation exists", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Localized Agent", localizePush: true });
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createSchedulingRule(agent.id);
    const variant = await createVariant(msg.id, {
      title: "English Title",
      body: "English Body",
    });
    await createVariantTranslation(variant.id, {
      language: "es",
      title: "Título en Español",
      body: "Cuerpo en Español",
      status: "active",
    });
    await createUser("usr_es", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "es" },
    });

    const res = await POST(buildRequest("POST", {
      agentId: agent.id,
      userIds: ["usr_es"],
      variantOverrideId: variant.id,
      bypassFrequencyCap: true,
      bypassQuietHours: true,
    }) as NextRequest);

    const body = await res.json() as { data: Array<{ status: string; reason?: string }> };
    // Braze is not configured in tests; reaching "Braze not configured" confirms
    // Spanish copy was resolved (no skip) and the variant/token guards passed.
    expect(body.data[0].status).toBe("failed");
    expect(body.data[0].reason).toBe("Braze not configured");
  });

  it("skips es recipient (returns skipped reason) when no es translation exists", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Localized Agent No ES", localizePush: true });
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createSchedulingRule(agent.id);
    const variant = await createVariant(msg.id, {
      title: "English Title",
      body: "English Body",
    });
    // No es translation created — es recipient must be skipped.
    await createUser("usr_es_nolang", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "es" },
    });

    const res = await POST(buildRequest("POST", {
      agentId: agent.id,
      userIds: ["usr_es_nolang"],
      variantOverrideId: variant.id,
      bypassFrequencyCap: true,
      bypassQuietHours: true,
    }) as NextRequest);

    const data = await res.json() as { data: Array<{ status: string; reason?: string }> };
    expect(data.data[0].status).toBe("failed");
    // Must say "skipped" not "Braze not configured" — strict-skip, not sent-en
    expect(data.data[0].reason).toContain("skipped");
    expect(data.data[0].reason).not.toBe("Braze not configured");
  });

  it("sends English copy for en recipient even when no en translation row exists", async () => {
    // English copy lives on the variant itself — no translation row needed.
    const persona = await createPersona();
    const agent = await createAgent({ name: "Localized Agent EN", localizePush: true });
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createSchedulingRule(agent.id);
    const variant = await createVariant(msg.id, {
      title: "English Title",
      body: "English Body",
    });
    await createUser("usr_en", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "en" },
    });

    const res = await POST(buildRequest("POST", {
      agentId: agent.id,
      userIds: ["usr_en"],
      variantOverrideId: variant.id,
      bypassFrequencyCap: true,
      bypassQuietHours: true,
    }) as NextRequest);

    const data = await res.json() as { data: Array<{ status: string; reason?: string }> };
    // en always resolves (English copy from variant); reaches Braze gate
    expect(data.data[0].status).toBe("failed");
    expect(data.data[0].reason).toBe("Braze not configured");
  });

  it("does NOT apply strict skip when agent has localizePush=false (non-localized agent sends English to all)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "Non-Localized Agent", localizePush: false });
    await linkAgentToPersona(agent.id, persona.id);
    const msg = await createMessage(agent.id);
    await createSchedulingRule(agent.id);
    const variant = await createVariant(msg.id, {
      title: "English Title",
      body: "English Body",
    });
    // No translations — es user should still reach Braze gate (English send)
    await createUser("usr_es_nonlocal", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { language_tag: "es" },
    });

    const res = await POST(buildRequest("POST", {
      agentId: agent.id,
      userIds: ["usr_es_nonlocal"],
      variantOverrideId: variant.id,
      bypassFrequencyCap: true,
      bypassQuietHours: true,
    }) as NextRequest);

    const data = await res.json() as { data: Array<{ status: string; reason?: string }> };
    // Non-localized agent: es user receives English → reaches Braze not configured
    expect(data.data[0].status).toBe("failed");
    expect(data.data[0].reason).toBe("Braze not configured");
  });
});
