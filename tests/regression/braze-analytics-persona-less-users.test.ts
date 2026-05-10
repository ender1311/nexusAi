/**
 * Regression test: persona-less users' decisions must get brazeAnalyticsFetchedAt stamped.
 *
 * Bug: decisionIdsToUpdate was filtered to only users with personas:
 *   .filter((d) => personaByUserId.has(d.userId))
 * Persona-less users' decisions never got brazeAnalyticsFetchedAt set, causing
 * them to be re-fetched and reprocessed on every analytics cron run, which
 * inflated their UserArmStats over time.
 *
 * Fix: removed the persona filter — all decisions in a sendId group get stamped.
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

function mockBrazeAnalytics(clickRate: number, openRate: number, sentCount: number) {
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/sends/data_series")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              time: new Date().toISOString(),
              sent: sentCount,
              unique_clicks: Math.round(sentCount * clickRate / 100),
              unique_opens: Math.round(sentCount * openRate / 100),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET    = "test_cron_secret";
  process.env.BRAZE_API_KEY  = "test_braze_key";
  process.env.BRAZE_REST_URL = "rest.test.braze.com";
  mockBrazeAnalytics(10, 30, 100);
});

afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("braze-analytics: persona-less user decisions get stamped", () => {
  it("decision for user with no persona gets brazeAnalyticsFetchedAt set after cron", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_no_persona" });
    const variant = await createVariant(msg.id);

    // User without a persona
    const user = await createUser("usr-no-persona", { personaId: null });
    const sentAt = new Date(Date.now() - 36 * 60 * 60 * 1000); // 36h ago (within 24-72h window)

    await prisma.userDecision.create({
      data: {
        agentId:          agent.id,
        userId:           user.externalId,
        messageVariantId: variant.id,
        channel:          "push",
        sentAt,
        brazeSendId:      "send_no_persona_001",
      },
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const decision = await prisma.userDecision.findFirst({
      where: { userId: user.externalId, agentId: agent.id },
    });
    expect(decision).not.toBeNull();
    // Before the fix this was null because persona-less users were excluded from decisionIdsToUpdate
    expect(decision!.brazeAnalyticsFetchedAt).not.toBeNull();
  });

  it("decisions for both persona and persona-less users get stamped in the same sendId group", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_mixed" });
    const variant = await createVariant(msg.id);

    const withPersona    = await createUser("usr-with-persona",    { personaId: persona.id });
    const withoutPersona = await createUser("usr-without-persona", { personaId: null });
    const sentAt = new Date(Date.now() - 36 * 60 * 60 * 1000);

    await prisma.userDecision.createMany({
      data: [
        {
          agentId:          agent.id,
          userId:           withPersona.externalId,
          messageVariantId: variant.id,
          channel:          "push",
          sentAt,
          brazeSendId:      "send_mixed_001",
        },
        {
          agentId:          agent.id,
          userId:           withoutPersona.externalId,
          messageVariantId: variant.id,
          channel:          "push",
          sentAt,
          brazeSendId:      "send_mixed_001",
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    await POST(req);

    const decisions = await prisma.userDecision.findMany({
      where: { brazeSendId: "send_mixed_001" },
    });
    expect(decisions).toHaveLength(2);
    for (const d of decisions) {
      expect(d.brazeAnalyticsFetchedAt).not.toBeNull();
    }
  });

  it("persona-less decisions are not reprocessed on a second cron run", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_idempotent" });
    const variant = await createVariant(msg.id);
    const user    = await createUser("usr-idempotent", { personaId: null });
    const sentAt  = new Date(Date.now() - 36 * 60 * 60 * 1000);

    await prisma.userDecision.create({
      data: {
        agentId:          agent.id,
        userId:           user.externalId,
        messageVariantId: variant.id,
        channel:          "push",
        sentAt,
        brazeSendId:      "send_idempotent_001",
      },
    });

    const mkReq = () =>
      new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
        method: "POST",
        headers: AUTH,
      });

    const body1 = await (await POST(mkReq())).json();
    const body2 = await (await POST(mkReq())).json();

    // First run processes 1 decision; second run should process 0
    // (brazeAnalyticsFetchedAt acts as a processed flag so the query excludes it)
    expect(body1.updated).toBe(1);
    expect(body2.processed).toBe(0);
  });
});
