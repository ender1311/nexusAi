// tests/integration/giving-conversion.test.ts
// Tests that gift_amount_most_recent_timestamp in user sync triggers
// conversion attribution on pending UserDecision records.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createGoal,
  createMessage,
  createVariant,
  createDecision,
} from "../helpers/builders";
import { POST as ingestUsers } from "@/app/api/ingest/users/route";
import { NextRequest } from "next/server";

const AUTH = { Authorization: "Bearer test_ingest_key" };

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/ingest/users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...AUTH,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("giving conversion attribution", () => {
  it("attributes a gift_given conversion when gift timestamp is within 30-day window", async () => {
    // Create agent with a gift_given goal
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "good" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    // Create a pending decision sent 5 days ago (with brazeSendId to mark as delivered)
    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_gift_test",
      messageVariantId: variant.id,
      channel: "push",
      sentAt,
      brazeSendId: "test_braze_send_001",
    });

    // Send user sync with gift timestamp 1 day after the decision
    const giftDate = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
    const req = buildRequest({
      users: [
        {
          external_user_id: "user_gift_test",
          attributes: {
            gift_amount_most_recent_timestamp: giftDate.toISOString(),
            gift_amount_most_recent: 50,
            gift_amount_average: 40,
            gift_count_lifetime: 3,
            gift_count_past_3_to_36_months: 2,
          },
        },
      ],
    });

    const res = await ingestUsers(req);
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({
      where: { id: decision.id },
    });
    expect(updated?.conversionEvent).toBe("gift_given");
    expect(updated?.conversionAt).not.toBeNull();
    expect(updated?.reward).not.toBeNull();
  });

  it("does NOT attribute when gift timestamp is outside 30-day window", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "good" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    // Decision sent 31 days ago — outside window
    const sentAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_gift_outside",
      messageVariantId: variant.id,
      channel: "push",
      sentAt,
    });

    const giftDate = new Date(); // now — 31 days after the send
    const req = buildRequest({
      users: [
        {
          external_user_id: "user_gift_outside",
          attributes: {
            gift_amount_most_recent_timestamp: giftDate.toISOString(),
            gift_amount_most_recent: 50,
          },
        },
      ],
    });

    await ingestUsers(req);

    const unchanged = await prisma.userDecision.findUnique({
      where: { id: decision.id },
    });
    expect(unchanged?.conversionAt).toBeNull();
  });

  it("does NOT re-attribute an already-attributed decision", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "good" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const alreadyAttributedAt = new Date(sentAt.getTime() + 12 * 60 * 60 * 1000);

    // Decision already has conversionAt set
    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_already_attributed",
      messageVariantId: variant.id,
      channel: "push",
      sentAt,
    });
    await prisma.userDecision.update({
      where: { id: decision.id },
      data: { conversionAt: alreadyAttributedAt, conversionEvent: "other_event" },
    });

    const giftDate = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
    const req = buildRequest({
      users: [
        {
          external_user_id: "user_already_attributed",
          attributes: {
            gift_amount_most_recent_timestamp: giftDate.toISOString(),
            gift_amount_most_recent: 50,
          },
        },
      ],
    });

    await ingestUsers(req);

    const unchanged = await prisma.userDecision.findUnique({
      where: { id: decision.id },
    });
    expect(unchanged?.conversionEvent).toBe("other_event"); // unchanged
  });
});
