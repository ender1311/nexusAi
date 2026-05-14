// tests/regression/ingest-cross-request-idempotency.test.ts
//
// REGRESSION: /api/ingest/events had no cross-request idempotency.
// Hightouch retries the same event_id in a new HTTP request; the first
// request attributed the event to decision A, leaving decision B
// unattributed. The retry found decision B and attributed it too —
// doubling arm-stat updates and corrupting the bandit's learning.
// Fixed by writing ProcessedEventId after each attribution.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createGoal, createMessage, createVariant, createUserDecision } from "../helpers/builders";
import { POST } from "@/app/api/ingest/events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("cross-request idempotency via ProcessedEventId (regression)", () => {
  it("same event_id sent in two requests only attributes once", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3600_000);
    // Two unattributed decisions — retry must not consume both
    await createUserDecision({ agentId: agent.id, userId: "usr_idem_reg", messageVariantId: variant.id, sentAt });
    await createUserDecision({ agentId: agent.id, userId: "usr_idem_reg", messageVariantId: variant.id, sentAt });

    const payload = {
      event_id: "reg_idem_001", event_name: "plan_started",
      external_user_id: "usr_idem_reg", occurred_at: new Date().toISOString(),
    };

    const res1 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    expect((await res1.json()).matched).toBe(1);

    // Retry — must be a no-op
    const res2 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.matched).toBe(0);
    expect(body2.unmatched).toBe(1);

    const attributed = await prisma.userDecision.count({
      where: { userId: "usr_idem_reg", conversionAt: { not: null } },
    });
    expect(attributed).toBe(1);
  });
});
