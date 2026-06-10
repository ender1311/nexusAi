// Regression (2026-06-09 audit, M1): fixed-cohort materialization used
// createMany skipDuplicates for assignment rows. externalUserId is globally
// @unique, so a returning user with an old RELEASED assignment row was silently
// skipped — locked into the cohort but never re-activated, invisible to
// ownership/conversion logic. The fix partitions returning vs. new users and
// upserts the returning rows (mirroring the continuous open-enrollment pass).
// Guards the cohort materialization block in
// src/app/api/cron/select-and-send/route.ts.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createUser, createSchedulingRule,
  linkAgentToPersona, createUserAgentAssignment,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let _originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
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
  globalThis.fetch = _originalFetch;
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
});

describe("regression: cohort materialization re-activates released assignment rows", () => {
  it("returning user (old released row) is re-activated alongside a truly new user", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" }); // fixed enrollment (default)
    await prisma.agent.update({ where: { id: agent.id }, data: { uniqueUsersCap: 5 } });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Returning user: released by a PRIOR run (lock already cleared).
    const oldStart = new Date(Date.now() - 60 * 86_400_000);
    await createUser("usr_m1_returning", { personaId: persona.id, funnelStage: "wau" });
    await createUserAgentAssignment({
      externalUserId: "usr_m1_returning",
      agentId: agent.id,
      sendCount: 3,
      startedAt: oldStart,
      releasedAt: new Date(Date.now() - 10 * 86_400_000),
      releaseReason: "manual",
    });
    // Truly new user: no assignment row at all (createMany branch).
    await createUser("usr_m1_new", { personaId: persona.id, funnelStage: "wau" });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const freshAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(freshAgent!.cohortAssignedAt).not.toBeNull();

    // The returning user's row must be ACTIVE again, not stuck in released state.
    const returning = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_m1_returning" },
    });
    expect(returning!.releasedAt).toBeNull();
    expect(returning!.releaseReason).toBeNull();
    expect(returning!.agentId).toBe(agent.id);
    expect(returning!.sendCount).toBe(0); // reset for the fresh enrollment
    expect(returning!.startedAt.getTime()).toBeGreaterThan(oldStart.getTime());

    const tuReturning = await prisma.trackedUser.findUnique({ where: { externalId: "usr_m1_returning" } });
    expect(tuReturning!.lockedByAgentId).toBe(agent.id);

    // Control: the brand-new user enrolls via the createMany branch.
    const fresh = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_m1_new" },
    });
    expect(fresh).not.toBeNull();
    expect(fresh!.agentId).toBe(agent.id);
    expect(fresh!.releasedAt).toBeNull();
    const tuNew = await prisma.trackedUser.findUnique({ where: { externalId: "usr_m1_new" } });
    expect(tuNew!.lockedByAgentId).toBe(agent.id);
  });
});
