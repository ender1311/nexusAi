// tests/regression/cron-malformed-segment-targeting.test.ts
//
// REGRESSION: the cron pre-assignment phase read segmentTargeting with
// `segTargeting?.includes.length` (src/app/api/cron/select-and-send/route.ts).
// The optional chain only guarded a null agent.segmentTargeting; if the stored
// JSON was a non-null object MISSING the `includes` key (legacy data, or a row
// written outside the validated PATCH/POST path), `.includes` was undefined and
// `.length` threw a TypeError — crashing the ENTIRE cron run for ALL agents, not
// just the one with bad data. The sibling paths (page.tsx, exploration window)
// already used the defensive `?.includes?.length`. Fixed to match them.
//
// This test seeds an agent whose segmentTargeting JSON has no `includes` key and
// asserts the cron returns 200 (does not 500), proving one malformed row no
// longer takes down the whole run.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
} from "../helpers/builders";

import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

let _originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET    = "test_cron_secret";
  process.env.BRAZE_API_KEY  = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";

  _originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201, headers: { "Content-Type": "application/json" },
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

describe("regression: cron survives malformed segmentTargeting JSON", () => {
  it("does not 500 when an agent's segmentTargeting has no includes key (exclude-only legacy shape)", async () => {
    const persona = await createPersona();

    // Healthy funnel-stage agent that should still send normally.
    const healthy = await createAgent({ name: "Healthy", funnelStage: "wau" });
    const hMsg = await createMessage(healthy.id, { brazeCampaignId: "camp_healthy" });
    await createVariant(hMsg.id);
    await linkAgentToPersona(healthy.id, persona.id);
    await createSchedulingRule(healthy.id);

    // Malformed agent: segmentTargeting is a non-null object WITHOUT `includes`.
    // Written via raw update to bypass the typed builder/validators (simulates
    // legacy / out-of-band data).
    const bad = await createAgent({ name: "Bad", funnelStage: "wau" });
    const bMsg = await createMessage(bad.id, { brazeCampaignId: "camp_bad" });
    await createVariant(bMsg.id);
    await linkAgentToPersona(bad.id, persona.id);
    await createSchedulingRule(bad.id);
    await prisma.agent.update({
      where: { id: bad.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { segmentTargeting: { excludes: ["seg_x"] } as any },
    });

    await createUser("usr_1", { personaId: persona.id, funnelStage: "wau" });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    // Before the fix this threw TypeError → 500. Now the run completes.
    expect(res.status).toBe(200);
    expect(body).toHaveProperty("sent");
  });

  it("treats segmentTargeting={} as no segment targeting (falls through to funnel stage)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ name: "EmptyObj", funnelStage: "wau" });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_emptyobj" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);
    await prisma.agent.update({
      where: { id: agent.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { segmentTargeting: {} as any },
    });

    await createUser("usr_funnel", { personaId: persona.id, funnelStage: "wau" });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Empty object => no includes => funnel-stage path => the wau user is sent to.
    expect(body.sent).toBe(1);
  });
});
