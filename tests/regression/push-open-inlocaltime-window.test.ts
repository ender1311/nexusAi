// Regression: the push-open matcher windowed attribution on `sentAt` with a flat
// 48h lookback, but `in_local_time` sends deliver up to 12h after their UTC
// `scheduledFor` anchor (far-west timezones). A late opener could open >48h after
// `sentAt` and be silently dropped — even though it sits well within the delivery +
// open horizon. The fix widens the push-open lookback by the 12h local-time buffer
// (48h → 60h), mirroring LOCAL_TIME_DELIVERY_BUFFER_MS in agent-send-delivery-status.ts.
//
// These tests pin the new boundary: an open at ~55h (past the old 48h, inside 60h)
// must attribute; an open past 60h must not.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createMessage, createVariant, createUser, createUserDecision } from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

async function seedPushDecision(name: string, userId: string, sentAt: Date) {
  const agent = await createAgent({ name });
  const variant = await createVariant(
    (await createMessage(agent.id, { brazeCampaignId: `camp_${name}` })).id,
    { brazeVariantId: `var_${name}` },
  );
  await createUser(userId, { brazeId: userId });
  return createUserDecision({
    agentId: agent.id,
    userId,
    messageVariantId: variant.id,
    channel: "push",
    sentAt,
  });
}

describe("push-open attribution: in_local_time delivery window (48h → 60h)", () => {
  it("attributes an open that lands 55h after sentAt (past the old 48h window)", async () => {
    const userId = "70000001";
    const now = new Date();
    const decision = await seedPushDecision("LocalLate", userId, new Date(now.getTime() - 55 * HOUR));
    expect(decision.pushOpenAt).toBeNull();

    const res = await POST(buildRequest("POST", {
      events: [{
        event_id: `${userId}:${now.toISOString()}`,
        event_name: "push_open",
        external_user_id: userId,
        occurred_at: now.toISOString(),
        properties: { braze_user_id: userId },
      }],
    }, AUTH) as NextRequest);

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(1);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.pushOpenAt).not.toBeNull();
  });

  it("does NOT attribute an open that lands 61h after sentAt (past the 60h window)", async () => {
    const userId = "70000002";
    const now = new Date();
    const decision = await seedPushDecision("LocalTooLate", userId, new Date(now.getTime() - 61 * HOUR));

    const res = await POST(buildRequest("POST", {
      events: [{
        event_id: `${userId}:${now.toISOString()}`,
        event_name: "push_open",
        external_user_id: userId,
        occurred_at: now.toISOString(),
        properties: { braze_user_id: userId },
      }],
    }, AUTH) as NextRequest);

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(0);
    expect(body.unmatched).toBe(1);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.pushOpenAt).toBeNull();
  });
});
