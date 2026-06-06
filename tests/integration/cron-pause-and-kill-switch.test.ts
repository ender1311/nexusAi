import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createUser,
  createUserAgentAssignment,
} from "../helpers/builders";

import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let _originalFetch: typeof globalThis.fetch;

async function setGlobal(v: "true" | "false") {
  await prisma.appSetting.upsert({
    where: { key: "global_sending_paused" },
    update: { value: v },
    create: { key: "global_sending_paused", value: v },
  });
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";

  // Intercept only Braze HTTP calls; pass all other fetch calls (e.g., Neon DB) through to the
  // original fetch so Prisma queries still hit the real test database.
  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return _originalFetch(input, init);
  };
});

afterEach(async () => {
  // Restore fetch before truncateAll so Prisma DB calls work
  globalThis.fetch = _originalFetch;
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
});

describe("cron pause flag + global kill switch", () => {
  it("active+unpaused agent query excludes sendingPaused agents", async () => {
    const unpaused = await createAgent({ name: "Unpaused Agent", sendingPaused: false });
    const paused = await createAgent({ name: "Paused Agent", sendingPaused: true });

    const agents = await prisma.agent.findMany({
      where: { status: "active", sendingPaused: false },
    });
    const ids = agents.map((a) => a.id);

    expect(ids).toContain(unpaused.id);
    expect(ids).not.toContain(paused.id);
  });

  it("global kill switch returns { paused: true } with 200", async () => {
    await setGlobal("true");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(true);
  });

  it("global kill switch does NOT release cohorts/locks/assignments", async () => {
    const cohortAssignedAt = new Date(Date.now() - 86_400_000);
    const agent = await createAgent({ name: "Locked Agent" });
    await prisma.agent.update({
      where: { id: agent.id },
      data: { cohortAssignedAt },
    });

    await createUser("usr_locked", { funnelStage: "wau" });
    await prisma.trackedUser.update({
      where: { externalId: "usr_locked" },
      data: { lockedByAgentId: agent.id },
    });

    await createUserAgentAssignment({
      externalUserId: "usr_locked",
      agentId: agent.id,
      releasedAt: null,
    });

    await setGlobal("true");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_locked" },
    });
    expect(assignment!.releasedAt).toBeNull();

    const user = await prisma.trackedUser.findUnique({
      where: { externalId: "usr_locked" },
    });
    expect(user!.lockedByAgentId).toBe(agent.id);

    const reloadedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(reloadedAgent!.cohortAssignedAt!.getTime()).toBe(cohortAssignedAt.getTime());
  });
});
