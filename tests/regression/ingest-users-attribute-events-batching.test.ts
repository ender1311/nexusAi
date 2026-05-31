// tests/regression/ingest-users-attribute-events-batching.test.ts
//
// REGRESSION (Wave 4): attributeEvents() in /api/ingest/users previously did
// ~6 awaited DB calls per event in a serial loop, including a per-event
// findUnique(ProcessedEventId) and a fire-and-forget per-event
// create(ProcessedEventId). The idempotency write was best-effort (.catch(()=>{}))
// so a failed write could leave an event credited-but-unmarked → double
// arm-credit on a Hightouch retry.
//
// Now: the processed-ID set is pre-loaded in one findMany and newly-handled
// IDs are written once via createMany({ skipDuplicates }). These tests pin the
// behavior that batching must preserve: (1) cross-request idempotency, and
// (2) correct matched/unmatched accounting within a single multi-event batch.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createMessage,
  createVariant,
  createUserDecision,
  createUser,
  createPersona,
  linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("attributeEvents batching (regression)", () => {
  it("same push_open event_id across two requests only stamps pushOpenAt once", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_batch" });
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_batch_1", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // Two unattributed decisions — a retry must not consume the second slot.
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      events: [{
        event_id: "batch_open_001",
        event_name: "push_open",
        external_user_id: user.externalId,
        occurred_at: new Date().toISOString(),
        properties: { campaign_id: "camp_batch" },
      }],
    };

    const res1 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    expect((await res1.json()).matched).toBe(1);

    // Retry of the same event_id — must be a no-op (already in pre-loaded set).
    const res2 = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.matched).toBe(0);
    expect(body2.unmatched).toBe(1);

    const opened = await prisma.userDecision.count({
      where: { userId: user.externalId, pushOpenAt: { not: null } },
    });
    expect(opened).toBe(1);

    // Exactly one ProcessedEventId row was written for the event.
    const processed = await prisma.processedEventId.count({ where: { eventId: "batch_open_001" } });
    expect(processed).toBe(1);
  });

  it("a multi-event batch records each event_id exactly once and accounts matched/unmatched", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_multi" });
    const variant = await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    const user = await createUser("usr_batch_2", { personaId: persona.id });

    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, sentAt, messageVariantId: variant.id });

    const payload = {
      events: [
        // matches the single available decision
        {
          event_id: "multi_001",
          event_name: "push_open",
          external_user_id: user.externalId,
          occurred_at: new Date().toISOString(),
          properties: { campaign_id: "camp_multi" },
        },
        // no decision for this user → unmatched, but still marked processed
        {
          event_id: "multi_002",
          event_name: "push_open",
          external_user_id: "usr_no_decision",
          occurred_at: new Date().toISOString(),
          properties: { campaign_id: "camp_multi" },
        },
      ],
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(1);
    expect(body.unmatched).toBe(1);

    // Both events recorded exactly once via the batched createMany.
    const ids = (await prisma.processedEventId.findMany({
      where: { eventId: { in: ["multi_001", "multi_002"] } },
      select: { eventId: true },
    })).map((r) => r.eventId).sort();
    expect(ids).toEqual(["multi_001", "multi_002"]);
  });
});
