import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createMessage,
  createPersona,
  createSchedulingRule,
  createUser,
  createVariant,
} from "../helpers/builders";
import { userLocalDate } from "@/lib/votd/local-date";

// Admin session required by the route.
const mockAuth = {
  user: { id: "u1", email: "dan.luk@youversion.com", firstName: null, lastName: null },
  roles: ["admin"],
};
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => mockAuth,
  signOut: async () => {},
}));

const { POST } = await import("@/app/api/demo/send/route");

const realFetch = globalThis.fetch;

async function setupGpAgent(variantOverrides?: { title?: string | null; body?: string; name?: string }) {
  // decideForUser requires at least one active persona; create one so the bandit path works.
  await createPersona({ name: "default", isActive: true });
  const agent = await createAgent({ name: "Nova" });
  const message = await createMessage(agent.id);
  const variant = await createVariant(message.id, {
    name: "GP: Reference + Verse Text",
    title: "{{gp_verse_ref}}",
    body: "{{gp_verse_text}}",
    deeplink: "https://www.bible.com/guides/1",
    ...variantOverrides,
  });
  await createUser("usr_gp_demo", { attributes: { timezone: "America/Chicago" } });
  await createSchedulingRule(agent.id);
  return { agent, variant };
}

function send(agentId: string, extra?: Record<string, unknown>) {
  return POST(
    buildRequest("POST", { agentId, userIds: ["usr_gp_demo"], bypassFrequencyCap: true, bypassQuietHours: true, ...extra }) as NextRequest
  );
}

describe("POST /api/demo/send — GP variants", () => {
  beforeEach(async () => {
    await truncateAll();
    await prisma.guidedPrayerDailyContent.deleteMany();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("fails the user (not the request) when GP content is unavailable", async () => {
    const { agent } = await setupGpAgent();
    globalThis.fetch = (async () =>
      new Response("upstream down", { status: 500 })) as unknown as typeof fetch;

    const res = await send(agent.id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ status: string; reason?: string }> };
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("GP content unavailable");
  });

  test("resolves GP tags from cached content before the Braze gate", async () => {
    const { agent } = await setupGpAgent();
    // Pre-seed today's GP row so no API fetch is needed.
    const today = userLocalDate(null, new Date()); // America/Chicago fallback
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: today,
        languageTag: "en",
        usfm: "JOS.1.9",
        reference: "Joshua 1:9",
        verseText: "Have I not commanded you? Be strong and courageous.",
        imageUrl: null,
      },
    });
    // Any fetch would indicate a cache miss — that's a bug.
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch — should have hit cache");
    }) as unknown as typeof fetch;

    const res = await send(agent.id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ status: string; reason?: string }> };
    // Braze env vars absent in tests — reaching the Braze gate means GP content
    // resolved and tags were substituted without error.
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("Braze not configured");
  });

  test("rejects variant override that doesn't belong to the requested agent", async () => {
    const { agent } = await setupGpAgent();
    const otherAgent = await createAgent({ name: "Other" });
    const otherMsg = await createMessage(otherAgent.id);
    const otherVariant = await createVariant(otherMsg.id, { body: "other" });

    const res = await send(agent.id, { variantOverrideId: otherVariant.id });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ status: string; reason?: string }> };
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toMatch(/override variant not found/i);
  });

  test("variant override resolves GP tags for the forced variant", async () => {
    const { agent } = await setupGpAgent();
    const today = userLocalDate(null, new Date());
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: today,
        languageTag: "en",
        usfm: "JOS.1.9",
        reference: "Joshua 1:9",
        verseText: "Have I not commanded you? Be strong and courageous.",
        imageUrl: null,
      },
    });
    globalThis.fetch = (async () => { throw new Error("unexpected fetch"); }) as unknown as typeof fetch;

    // Create a second variant on the same message and override to it.
    const message = await prisma.message.findFirst({ where: { agentId: agent.id } });
    const refOnlyVariant = await createVariant(message!.id, {
      name: "GP: Label + Reference",
      title: "{{guided_prayer_label}}",
      body: "{{gp_verse_ref}}",
    });

    const res = await send(agent.id, { variantOverrideId: refOnlyVariant.id });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ status: string; reason?: string }> };
    // Reaches Braze gate (GP content resolved) — wrong variant would produce GP unavailable.
    expect(data[0].reason).toBe("Braze not configured");
  });

  test("non-GP plain variant is not mis-routed to GP content path", async () => {
    const agent = await createAgent({ name: "Plain" });
    const message = await createMessage(agent.id);
    await createVariant(message.id, { name: "Static", title: "Hello", body: "World" });
    await createUser("usr_gp_demo2", {});
    await createSchedulingRule(agent.id);

    // GP API should never be called for a plain variant.
    let fetchCalled = false;
    globalThis.fetch = (async (url: string) => {
      if (typeof url === "string" && url.includes("guidedprayers")) fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await POST(
      buildRequest("POST", { agentId: agent.id, userIds: ["usr_gp_demo2"], bypassFrequencyCap: true, bypassQuietHours: true }) as NextRequest
    );
    expect(res.status).toBe(200);
    expect(fetchCalled).toBe(false);
  });
});
