// tests/integration/sower-conversion.test.ts
// Tests that a false→true flip on has_recurring_gift during user sync synthesizes
// a sower_subscribed conversion against the owning Nexus send, persists the column,
// and that backfill/no-flip cases never manufacture a conversion.

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

// Seed a TrackedUser with a known prior hasRecurringGift state. The builder does
// not expose the column, so set it directly.
async function seedUser(externalId: string, hasRecurringGift: boolean | null) {
  return prisma.trackedUser.create({
    data: {
      externalId,
      attributes: { language_tag: "en" },
      hasRecurringGift,
    },
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

describe("sower (recurring-giver) conversion synthesis", () => {
  it("synthesizes a sower_subscribed conversion on a false→true flip within the window", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_sower_flip", false);

    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_sower_flip",
      messageVariantId: variant.id,
      channel: "push",
      sentAt,
      brazeSendId: "braze_sower_001",
    });
    await createUserAgentAssignment({ externalUserId: "user_sower_flip", agentId: agent.id });

    const req = buildRequest({
      users: [{ external_user_id: "user_sower_flip", attributes: { has_recurring_gift: true } }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.conversionEvent).toBe("sower_subscribed");
    expect(updated?.conversionAt).not.toBeNull();
    expect(updated?.reward).toBe(1.0); // flat maximum

    // Column persisted
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "user_sower_flip" } });
    expect(user?.hasRecurringGift).toBe(true);

    // Owning assignment released on conversion
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "user_sower_flip" },
    });
    expect(assignment?.releasedAt).not.toBeNull();
    expect(assignment?.releaseReason).toBe("conversion");
  });

  it("does NOT synthesize when the prior value was already true (no flip)", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_sower_noflip", true);

    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_sower_noflip",
      messageVariantId: variant.id,
      channel: "push",
      sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      brazeSendId: "braze_sower_noflip",
    });

    const req = buildRequest({
      users: [{ external_user_id: "user_sower_noflip", attributes: { has_recurring_gift: true } }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const unchanged = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(unchanged?.conversionAt).toBeNull();
  });

  it("does NOT synthesize on a first observation (prior null) — backfill safety", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_sower_firstobs", null);

    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_sower_firstobs",
      messageVariantId: variant.id,
      channel: "push",
      sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      brazeSendId: "braze_sower_firstobs",
    });

    const req = buildRequest({
      users: [{ external_user_id: "user_sower_firstobs", attributes: { has_recurring_gift: true } }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const unchanged = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(unchanged?.conversionAt).toBeNull();

    // Column still records the observed true so a later real flip can be detected.
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "user_sower_firstobs" } });
    expect(user?.hasRecurringGift).toBe(true);
  });

  it("does NOT synthesize when the owning send is outside the 30-day window", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_sower_old", false);

    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_sower_old",
      messageVariantId: variant.id,
      channel: "push",
      sentAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // outside window
      brazeSendId: "braze_sower_old",
    });

    const req = buildRequest({
      users: [{ external_user_id: "user_sower_old", attributes: { has_recurring_gift: true } }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const unchanged = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(unchanged?.conversionAt).toBeNull();
    // Flip is still recorded on the column even when no send is creditable.
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "user_sower_old" } });
    expect(user?.hasRecurringGift).toBe(true);
  });

  it("is type-tolerant: a string \"true\" flip synthesizes the conversion", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "sower_subscribed", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    await seedUser("user_sower_str", false);

    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_sower_str",
      messageVariantId: variant.id,
      channel: "push",
      sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      brazeSendId: "braze_sower_str",
    });

    const req = buildRequest({
      users: [{ external_user_id: "user_sower_str", attributes: { has_recurring_gift: "true" } }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.conversionEvent).toBe("sower_subscribed");
    expect(updated?.reward).toBe(1.0);
  });
});
