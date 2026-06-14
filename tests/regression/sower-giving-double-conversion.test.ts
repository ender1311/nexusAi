// tests/regression/sower-giving-double-conversion.test.ts
//
// REGRESSION (C1): the user sync runs three attribution passes per user in one
// iteration — funnel-recovery, sower-subscription synthesis, then giving
// attribution. All three draw candidate decisions from the SAME pool of
// unattributed confirmed sends (conversionAt: null, brazeSendId IS NOT NULL),
// and each pool is preloaded once at the top of the chunk BEFORE any pass runs.
// Without a per-iteration guard, a single decision credited by the sower pass
// would still appear in the giving pool's in-memory list and get re-credited as
// gift_given in the same sync — double-counting one send and clobbering the
// sower conversion. The route now records credited decision ids and giving
// skips them. This test fails if that guard is removed.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  createAgent,
  createGoal,
  createMessage,
  createVariant,
  createDecision,
  createUserAgentAssignment,
} from "../helpers/builders";
import { POST as ingestUsers } from "@/app/api/ingest/users/route";
import { NextRequest } from "next/server";

const AUTH = { Authorization: "Bearer test_ingest_key" };

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/ingest/users", {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify(body),
  });
}

// Sower-flip synthesis keys on the YouVersion-specific recurring flag
// (hasRecurringGiftYouversion / has_recurring_gift_youversion), so seed/flip that.
async function seedUser(externalId: string, hasRecurringGiftYouversion: boolean | null) {
  return prisma.trackedUser.create({
    data: { externalId, attributes: { language_tag: "en" }, hasRecurringGiftYouversion },
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

describe("regression: sower + giving never double-credit one decision", () => {
  it("a single creditable send is credited to sower only, not also gift_given", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_dual", false);

    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_dual",
      messageVariantId: variant.id,
      channel: "push",
      sentAt,
      brazeSendId: "braze_dual_001",
    });
    await createUserAgentAssignment({ externalUserId: "user_dual", agentId: agent.id });

    // Same sync carries BOTH a sower flip (false→true) and a recent gift whose
    // attribution window covers the same send. Sower runs first and wins.
    const giftDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const req = buildRequest({
      users: [{
        external_user_id: "user_dual",
        attributes: {
          has_recurring_gift_youversion: true,
          gift_amount_most_recent_timestamp: giftDate.toISOString(),
          gift_amount_most_recent: 25,
          gift_currency_most_recent: "USD",
        },
      }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    // Credited to sower (first pass), NOT overwritten by giving.
    expect(updated?.conversionEvent).toBe("sower_subscribed");
    // gift_given would have written a conversionValue; sower does not.
    expect(updated?.conversionValue).toBeNull();
  });

  it("two creditable sends: sower credits one, giving credits the OTHER", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_two", false);

    // Older send + newer send, both unattributed within window.
    const older = await createDecision({
      agentId: agent.id,
      userId: "user_two",
      messageVariantId: variant.id,
      channel: "push",
      sentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      brazeSendId: "braze_two_older",
    });
    const newer = await createDecision({
      agentId: agent.id,
      userId: "user_two",
      messageVariantId: variant.id,
      channel: "push",
      sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      brazeSendId: "braze_two_newer",
    });
    await createUserAgentAssignment({ externalUserId: "user_two", agentId: agent.id });

    const giftDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const req = buildRequest({
      users: [{
        external_user_id: "user_two",
        attributes: {
          has_recurring_gift_youversion: true,
          gift_amount_most_recent_timestamp: giftDate.toISOString(),
          gift_amount_most_recent: 25,
          gift_currency_most_recent: "USD",
        },
      }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    // Both passes pick the most-recent unattributed send first (sentAt desc).
    // Sower takes `newer`; giving must skip it and fall to `older`.
    const newerRow = await prisma.userDecision.findUnique({ where: { id: newer.id } });
    const olderRow = await prisma.userDecision.findUnique({ where: { id: older.id } });
    expect(newerRow?.conversionEvent).toBe("sower_subscribed");
    expect(olderRow?.conversionEvent).toBe("gift_given");
  });
});
