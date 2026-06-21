/**
 * Regression: the 48h no-engagement decay cron must NOT touch decisions that
 * already converted.
 *
 * Bug: the cron selected by (brazeSendId, brazeAnalyticsFetchedAt=null, sentAt<=cutoff)
 * without excluding conversionAt. A user who converted (e.g. a gift) on a push that
 * was never "opened" had their conversion reward overwritten to -0.35 and a β penalty
 * added — punishing a real success.
 *
 * Fix: WHERE conversionAt: null. Converted decisions are resolved by attribution and
 * are skipped entirely by the decay cron.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createUser } from "../helpers/builders";
import { POST } from "@/app/api/cron/ingest-braze-analytics/route";

const AUTH = { Authorization: "Bearer test_cron_secret" };

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
});

describe("decay cron: converted decisions are skipped", () => {
  it("a converted decision (no push open) is not penalized or reward-overwritten", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-converted");
    const sentAt = new Date(Date.now() - 60 * 60 * 60 * 1000); // 60h ago (> 48h cutoff)

    // Converted: attribution already set conversionAt + a positive reward, pushOpenAt null.
    await prisma.userDecision.create({
      data: {
        agentId: agent.id, userId: "usr-converted",
        messageVariantId: variant.id, channel: "push", sentAt,
        brazeSendId: "send_converted_001",
        conversionEvent: "gift_given", conversionAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
        reward: 0.5, conversionValue: 50,
      },
    });

    const req  = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", { method: "POST", headers: AUTH });
    const body = await (await POST(req)).json();

    // Excluded from selection entirely.
    expect(body.processed).toBe(0);

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr-converted" } });
    expect(decision!.reward).toBe(0.5);                 // unchanged, not -0.35
    expect(decision!.brazeAnalyticsFetchedAt).toBeNull(); // untouched
  });

  it("an unconverted no-open decision in the same run is still penalized", async () => {
    const agent   = await createAgent();
    const msg     = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr-converted2");
    await createUser("usr-miss");
    const sentAt = new Date(Date.now() - 60 * 60 * 60 * 1000);

    await prisma.userDecision.createMany({
      data: [
        { agentId: agent.id, userId: "usr-converted2", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_c2", conversionEvent: "gift_given", conversionAt: new Date(), reward: 0.5, conversionValue: 50 },
        { agentId: agent.id, userId: "usr-miss",       messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "send_m1" },
      ],
    });

    const req  = new NextRequest("http://localhost/api/cron/ingest-braze-analytics", { method: "POST", headers: AUTH });
    const body = await (await POST(req)).json();

    expect(body.processed).toBe(1);   // only the miss
    expect(body.penalized).toBe(1);

    const miss = await prisma.userDecision.findFirst({ where: { userId: "usr-miss" } });
    expect(miss!.reward).toBe(-0.35);
    const converted = await prisma.userDecision.findFirst({ where: { userId: "usr-converted2" } });
    expect(converted!.reward).toBe(0.5);
  });
});
