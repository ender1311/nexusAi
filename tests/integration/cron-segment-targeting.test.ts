import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
  createUserSegment,
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

describe("segmentTargeting: single include (new field)", () => {
  it("user in the include segment is eligible", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "wau",
      segmentTargeting: { includes: ["seg_a"], excludes: [] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_singleinclude" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await createUser("usr_in_seg_a", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_in_seg_a", "seg_a");

    // User NOT in seg_a should not be targeted
    await createUser("usr_not_in_seg_a", { personaId: persona.id, funnelStage: "wau" });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);

    const inDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_in_seg_a" } });
    const outDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_not_in_seg_a" } });
    expect(inDecisions).toHaveLength(1);
    expect(outDecisions).toHaveLength(0);
  });
});

describe("segmentTargeting: multi-include AND logic", () => {
  it("user in all include segments is eligible", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "wau",
      segmentTargeting: { includes: ["seg_a", "seg_b"], excludes: [] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_multiinclude" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User in both seg_a AND seg_b — should be sent to
    await createUser("usr_in_both", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_in_both", "seg_a");
    await createUserSegment("usr_in_both", "seg_b");

    // User in only seg_a — should NOT be sent to (AND logic)
    await createUser("usr_in_a_only", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_in_a_only", "seg_a");

    // User in only seg_b — should NOT be sent to (AND logic)
    await createUser("usr_in_b_only", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_in_b_only", "seg_b");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);

    const bothDecisions  = await prisma.userDecision.findMany({ where: { userId: "usr_in_both" } });
    const aOnlyDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_in_a_only" } });
    const bOnlyDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_in_b_only" } });
    expect(bothDecisions).toHaveLength(1);
    expect(aOnlyDecisions).toHaveLength(0);
    expect(bOnlyDecisions).toHaveLength(0);
  });

  it("sends to nobody when the intersection is empty", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "wau",
      segmentTargeting: { includes: ["seg_a", "seg_b"], excludes: [] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_emptyand" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Two users, each in only one segment — intersection is empty
    await createUser("usr_a_only2", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_a_only2", "seg_a");
    await createUser("usr_b_only2", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_b_only2", "seg_b");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
  });
});

describe("segmentTargeting: exclude logic on segment path", () => {
  it("user in include segment but NOT in exclude segment is eligible", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "wau",
      segmentTargeting: { includes: ["seg_a"], excludes: ["seg_b"] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_excl1" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User in seg_a only — eligible (in include, not in exclude)
    await createUser("usr_a_not_b", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_a_not_b", "seg_a");

    // User in seg_a AND seg_b — excluded (in both include and exclude)
    await createUser("usr_a_and_b", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_a_and_b", "seg_a");
    await createUserSegment("usr_a_and_b", "seg_b");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);

    const eligibleDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_a_not_b" } });
    const excludedDecisions  = await prisma.userDecision.findMany({ where: { userId: "usr_a_and_b" } });
    expect(eligibleDecisions).toHaveLength(1);
    expect(excludedDecisions).toHaveLength(0);
  });

  it("sends to nobody when all include members are also in the exclude segment", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "wau",
      segmentTargeting: { includes: ["seg_a"], excludes: ["seg_b"] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_excl2" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Only user is in both seg_a and seg_b — all members excluded
    await createUser("usr_both_excl", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_both_excl", "seg_a");
    await createUserSegment("usr_both_excl", "seg_b");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(0);
  });
});

describe("segmentTargeting: exclude logic on funnel-stage path", () => {
  it("user in correct funnelStage but in exclude segment is NOT eligible", async () => {
    const persona = await createPersona();
    // No includes — uses funnel-stage path; excludes still apply
    const agent = await createAgent({
      funnelStage: "wau",
      segmentTargeting: { includes: [], excludes: ["seg_b"] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_funnel_excl1" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User with correct funnelStage but in the excluded segment
    await createUser("usr_wau_in_b", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_wau_in_b", "seg_b");

    // User with correct funnelStage and NOT in the excluded segment
    await createUser("usr_wau_not_b", { personaId: persona.id, funnelStage: "wau" });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);

    const inBDecisions   = await prisma.userDecision.findMany({ where: { userId: "usr_wau_in_b" } });
    const notBDecisions  = await prisma.userDecision.findMany({ where: { userId: "usr_wau_not_b" } });
    expect(inBDecisions).toHaveLength(0);
    expect(notBDecisions).toHaveLength(1);
  });

  it("null segmentTargeting with no targetSegmentName uses funnel-stage path with no exclude filtering", async () => {
    const persona = await createPersona();
    const agent = await createAgent({
      funnelStage: "wau",
      // segmentTargeting omitted (null) and no targetSegmentName
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_funnel_baseline" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User with correct funnelStage — should be sent to
    await createUser("usr_wau_baseline", { personaId: persona.id, funnelStage: "wau" });

    // User with wrong funnelStage — should NOT be sent to (funnel filter still applies)
    await createUser("usr_lapsed_baseline", { personaId: persona.id, funnelStage: "lapsed" });

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);
    await res.json(); // consume body to avoid resource leak

    // Only the wau user should receive a send
    const wauDecisions    = await prisma.userDecision.findMany({ where: { userId: "usr_wau_baseline" } });
    const lapsedDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_lapsed_baseline" } });
    expect(wauDecisions.length).toBeGreaterThan(0);
    expect(lapsedDecisions).toHaveLength(0);
  });
});

describe("segmentTargeting: precedence over targetSegmentName", () => {
  it("segmentTargeting.includes takes precedence over targetSegmentName", async () => {
    const persona = await createPersona();
    // Agent has both targetSegmentName and segmentTargeting — segmentTargeting should win
    const agent = await createAgent({
      funnelStage: "wau",
      targetSegmentName: "seg_legacy",
      segmentTargeting: { includes: ["seg_a"], excludes: [] },
    });
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_precedence" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // User in seg_a (new) — should be targeted
    await createUser("usr_seg_a_prec", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_seg_a_prec", "seg_a");

    // User in seg_legacy (old) but NOT in seg_a — should NOT be targeted
    await createUser("usr_seg_legacy_prec", { personaId: persona.id, funnelStage: "wau" });
    await createUserSegment("usr_seg_legacy_prec", "seg_legacy");

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sent).toBe(1);

    const newDecisions    = await prisma.userDecision.findMany({ where: { userId: "usr_seg_a_prec" } });
    const legacyDecisions = await prisma.userDecision.findMany({ where: { userId: "usr_seg_legacy_prec" } });
    expect(newDecisions).toHaveLength(1);
    expect(legacyDecisions).toHaveLength(0);
  });
});
