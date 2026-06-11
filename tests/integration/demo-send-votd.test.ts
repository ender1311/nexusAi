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
import { __resetVotdCalendarCacheForTests } from "@/lib/votd/votd-content";
import { userLocalDate } from "@/lib/votd/local-date";

// Admin session is required by the route; stub it like api.demo.send.test.ts does.
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

async function setupVotdAgent() {
  const persona = await createPersona();
  const agent = await createAgent();
  const message = await createMessage(agent.id);
  const variant = await createVariant(message.id, {
    name: "VOTD: Label + Reference",
    title: "{{guided_scripture_label}}",
    body: "{{votd_reference}}",
    deeplink: "https://www.bible.com/stories",
  });
  await createUser("usr_votd_demo", { personaId: persona.id });
  await createSchedulingRule(agent.id);
  return { agent, variant };
}

function send(agentId: string) {
  return POST(
    buildRequest("POST", { agentId, userIds: ["usr_votd_demo"] }) as NextRequest
  );
}

describe("POST /api/demo/send — VOTD variants", () => {
  beforeEach(async () => {
    await truncateAll();
    await prisma.votdDailyContent.deleteMany();
    __resetVotdCalendarCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("fails the user (not the request) when VOTD content is unavailable", async () => {
    const { agent } = await setupVotdAgent();
    // Every upstream fetch fails -> getVotdContent returns null.
    globalThis.fetch = (async () =>
      new Response("upstream down", { status: 500 })) as unknown as typeof fetch;

    const res = await send(agent.id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ status: string; reason?: string }>;
    };
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("VOTD content unavailable");
  });

  test("resolves tags from cached content before the Braze gate", async () => {
    const { agent } = await setupVotdAgent();
    // Pre-seed today's row so no fetch is needed; user has no timezone
    // attribute -> America/Chicago fallback, language_tag "en" from builder.
    await prisma.votdDailyContent.create({
      data: {
        date: userLocalDate(null, new Date()),
        languageTag: "en",
        usfm: "JHN.3.16",
        reference: "John 3:16",
        verseText: "For God so loved the world...",
        versionId: 111,
        imageUrlIos: null,
        imageUrlAndroid: null,
      },
    });
    // Any fetch would be a bug (cache hit expected).
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;

    const res = await send(agent.id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ status: string; reason?: string }>;
    };
    // Braze env vars are absent in tests, so reaching the Braze gate proves
    // VOTD resolution + substitution completed without erroring.
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("Braze not configured");
  });
});
