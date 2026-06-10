// Regression (2026-06-09 audit, I4): uniqueUsersCap had dual semantics. It is
// enforced at ENROLLMENT (fixed agents cap their cohort at materialization,
// continuous agents cap concurrent enrollment headroom), but the send loop ALSO
// applied a lifetime COUNT(DISTINCT userId) trim over confirmed sends. Once
// `cap` distinct users had ever been sent to, that trim permanently blocked
// repeat sends to the enrolled cohort — including fresh cohorts after
// re-materialization. The lifetime trim was removed; this test pins the
// behavior: an enrolled user who already received a confirmed send still gets
// the next send even when the agent is at its cap.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
  createUserAgentAssignment, createDecision,
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

describe("regression: uniqueUsersCap does not block repeat sends to the enrolled cohort", () => {
  it("at-cap agent still sends again to its enrolled user with a prior confirmed send", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ funnelStage: "wau" }); // fixed enrollment (default)
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_i4" });
    await createVariant(msg.id, { brazeVariantId: "var_i4" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Already-materialized cohort of exactly uniqueUsersCap = 1 user.
    const cohortAt = new Date(Date.now() - 5 * 86_400_000);
    await prisma.agent.update({
      where: { id: agent.id },
      data: { uniqueUsersCap: 1, cohortAssignedAt: cohortAt },
    });
    await createUser("usr_i4_enrolled", { personaId: persona.id, funnelStage: "wau" });
    await prisma.trackedUser.update({
      where: { externalId: "usr_i4_enrolled" },
      data: { lockedByAgentId: agent.id },
    });
    await createUserAgentAssignment({
      externalUserId: "usr_i4_enrolled",
      agentId: agent.id,
      sendCount: 1,
      startedAt: cohortAt,
      lastSentAt: new Date(Date.now() - 2 * 86_400_000),
    });
    // Prior CONFIRMED send — pre-fix, this made COUNT(DISTINCT userId) == cap
    // and the lifetime trim suppressed every further send to this user.
    await createDecision({
      agentId: agent.id,
      userId: "usr_i4_enrolled",
      sentAt: new Date(Date.now() - 2 * 86_400_000),
      brazeSendId: "send_i4_prior",
    });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const confirmed = await prisma.userDecision.count({
      where: { agentId: agent.id, userId: "usr_i4_enrolled", brazeSendId: { not: null } },
    });
    expect(confirmed).toBe(2); // prior + the new send this run

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_i4_enrolled" },
    });
    expect(assignment!.sendCount).toBe(2);
  });
});
