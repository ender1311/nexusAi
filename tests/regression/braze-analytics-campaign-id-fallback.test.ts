/**
 * Regression test: ingest-braze-analytics must use BRAZE_NEXUS_CAMPAIGN_ID env var
 * when Message.brazeCampaignId is null.
 *
 * Bug: the route fetched `groupDecisions[0].variant?.message?.brazeCampaignId` and
 * skipped the whole sendId group with `if (!brazeCampaignId) continue`. All production
 * Message records have brazeCampaignId = null (created before the field was populated),
 * so the analytics cron never processed any decisions and no rewards were written.
 *
 * Fix: fall back to `process.env.BRAZE_NEXUS_CAMPAIGN_ID` before returning null.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createPersona,
  createMessage,
  createVariant,
  createUser,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/ingest-braze-analytics/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

function mockBrazeAnalyticsSuccess() {
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/sends/data_series")) {
      return new Response(
        JSON.stringify({
          data: [{ time: new Date().toISOString(), sent: 10, unique_clicks: 2, unique_opens: 5 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET            = "test_cron_secret";
  process.env.BRAZE_API_KEY          = "test_braze_key";
  process.env.BRAZE_REST_URL         = "rest.test.braze.com";
  process.env.BRAZE_NEXUS_CAMPAIGN_ID = "env-campaign-fallback-id";
  mockBrazeAnalyticsSuccess();
});

afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
  delete process.env.BRAZE_NEXUS_CAMPAIGN_ID;
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("braze-analytics: campaign ID env var fallback", () => {
  it("processes decisions whose message has brazeCampaignId = null by using env var", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    // No brazeCampaignId — this is the bug scenario
    const msg     = await createMessage(agent.id, { brazeCampaignId: null });
    const variant = await createVariant(msg.id);
    const user    = await createUser("usr-fallback-a", { personaId: persona.id });
    const sentAt  = new Date(Date.now() - 36 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: {
        agentId:          agent.id,
        userId:           user.externalId,
        messageVariantId: variant.id,
        channel:          "push",
        sentAt,
        brazeSendId:      "send-fallback-001",
      },
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Without the fix, processed would be 0 because the sendId group is skipped
    expect(body.processed).toBe(1);
    expect(body.updated).toBe(1);

    const decision = await prisma.userDecision.findFirst({
      where: { brazeSendId: "send-fallback-001" },
    });
    expect(decision?.brazeAnalyticsFetchedAt).not.toBeNull();
    expect(decision?.reward).not.toBeNull();
  });

  it("skips decisions when BRAZE_NEXUS_CAMPAIGN_ID is also absent", async () => {
    delete process.env.BRAZE_NEXUS_CAMPAIGN_ID;
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: null });
    const variant = await createVariant(msg.id);
    const user    = await createUser("usr-fallback-b", { personaId: persona.id });
    const sentAt  = new Date(Date.now() - 36 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: {
        agentId:          agent.id,
        userId:           user.externalId,
        messageVariantId: variant.id,
        channel:          "push",
        sentAt,
        brazeSendId:      "send-fallback-002",
      },
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Still skipped because both campaign ID sources are null
    expect(body.processed).toBe(0);
  });
});
