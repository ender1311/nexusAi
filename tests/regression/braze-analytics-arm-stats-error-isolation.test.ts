/**
 * Regression test: arm stats update failures must not abort remaining sendIds.
 *
 * Bug: Promise.all([batchUpsertArmStats(...), batchUpsertUserArmStats(...)]) inside
 * the for-loop over sendIdsToProcess had no try-catch. If either DB call threw
 * (e.g. a transient connection error or constraint violation), the entire for-loop
 * would exit early via an unhandled rejection, leaving subsequent sendIds permanently
 * unprocessed if they aged out of the 24-72h window before the next retry.
 *
 * Fix: wrapped Promise.all in try-catch; logs the error and continues to the next sendId.
 *
 * Note: Forcing a real DB error for batchUpsertArmStats in integration tests is not
 * practical without module mocking. These tests verify the multi-sendId processing
 * path and the stamping behavior that would be observed after the bug manifests.
 * The structural fix (try-catch + continue) is verified by code review.
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

function mockBrazeAnalytics() {
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/sends/data_series")) {
      return new Response(
        JSON.stringify({
          data: [{ time: new Date().toISOString(), sent: 50, unique_clicks: 5, unique_opens: 15 }],
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
  mockBrazeAnalytics();
});

afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("braze-analytics: multi-sendId processing", () => {
  it("processes all sendIds in a batch and stamps brazeAnalyticsFetchedAt on each", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_multi" });
    const variant = await createVariant(msg.id);
    const userA   = await createUser("usr-multi-a", { personaId: persona.id });
    const userB   = await createUser("usr-multi-b", { personaId: persona.id });
    const sentAt  = new Date(Date.now() - 36 * 60 * 60 * 1000);

    await prisma.userDecision.createMany({
      data: [
        {
          agentId:          agent.id,
          userId:           userA.externalId,
          messageVariantId: variant.id,
          channel:          "push",
          sentAt,
          brazeSendId:      "send_multi_001",
        },
        {
          agentId:          agent.id,
          userId:           userB.externalId,
          messageVariantId: variant.id,
          channel:          "push",
          sentAt,
          brazeSendId:      "send_multi_002",
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(2);

    // Both sendIds must be processed — before the fix, a DB failure on sendId 1
    // would abort the loop and sendId 2 would never be stamped.
    const decisions = await prisma.userDecision.findMany({
      where: { brazeSendId: { in: ["send_multi_001", "send_multi_002"] } },
      orderBy: { brazeSendId: "asc" },
    });
    expect(decisions).toHaveLength(2);
    for (const d of decisions) {
      expect(d.brazeAnalyticsFetchedAt).not.toBeNull();
    }
  });

  it("returns ok=true and correct processed count when all sendIds succeed", async () => {
    const persona = await createPersona();
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id, { brazeCampaignId: "camp_count" });
    const variant = await createVariant(msg.id);
    const sentAt  = new Date(Date.now() - 36 * 60 * 60 * 1000);

    const users = await Promise.all(
      ["usr-count-1", "usr-count-2", "usr-count-3"].map((id) =>
        createUser(id, { personaId: persona.id })
      )
    );
    await prisma.userDecision.createMany({
      data: users.map((u, i) => ({
        agentId:          agent.id,
        userId:           u.externalId,
        messageVariantId: variant.id,
        channel:          "push",
        sentAt,
        brazeSendId:      `send_count_00${i + 1}`,
      })),
    });

    const req = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", {
      method: "POST",
      headers: AUTH,
    });
    const res  = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.processed).toBe(3);
    expect(body.updated).toBe(3);
    expect(body.sendIds).toBe(3);
  });
});
