// Regression (2026-06-09 audit, R1): an UNCAPPED agent that hold-cap-releases a
// still-eligible user in Phase −1 must NOT re-recruit them via the lottery in
// the SAME cron run. Before the fix, the release sweep freed the user, the
// lottery immediately re-claimed them (the upsert resetting sendCount to 1 and
// clearing releasedAt/releaseReason), so hold caps never actually stopped an
// uncapped agent. Guards the releasedThisRun filter in
// src/app/api/cron/select-and-send/route.ts.
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

describe("regression: hold-cap release is not undone in the same cron run", () => {
  it("uncapped agent does not re-recruit the user it hold-cap-released this run", async () => {
    const persona = await createPersona();
    // Uncapped (no uniqueUsersCap) + low holdMaxSends so the sweep fires.
    const agent = await createAgent({ funnelStage: "wau", holdMaxSends: 2 });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_r1" });
    await createVariant(msg.id, { brazeVariantId: "var_r1" });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Still eligible (funnelStage matches the agent) but at the send cap.
    await createUser("usr_r1_capped", { personaId: persona.id, funnelStage: "wau" });
    await createUserAgentAssignment({
      externalUserId: "usr_r1_capped",
      agentId: agent.id,
      sendCount: 2,
    });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_r1_capped" },
    });
    // The release must stick: no same-run lottery re-claim by the releasing agent.
    expect(assignment!.releasedAt).not.toBeNull();
    expect(assignment!.releaseReason).toBe("hold_cap_sends");
    expect(assignment!.sendCount).toBe(2); // not reset by a re-claim upsert
  });
});
