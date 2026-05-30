// Regression: push opens were never attributed to any agent (0 of 123 sends had
// pushOpenAt set). Root cause: Braze push-open events key on Braze's internal
// 24-hex id, but a verified user's UserDecision is stored under their numeric
// YouVersion id (== TrackedUser.externalId). The time-window matcher compared
// `userId = event.external_user_id` (the braze id) and never found the decision.
//
// The fix bridges brazeId → externalId across the batch and matches the decision
// on the union of id forms. This test asserts both cohorts attribute correctly:
//   - verified:   send keyed on numeric id, open keyed on 24-hex braze id (bridge)
//   - unverified: externalId === brazeId, open keyed on that same id (direct match)
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createMessage, createVariant, createUser, createUserDecision } from "../helpers/builders";
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

describe("push-open attribution: braze-id → externalId bridge", () => {
  it("attributes an open keyed on the 24-hex braze id to a decision stored under the numeric YouVersion id", async () => {
    const youVersionId = "128802842";          // numeric external_user_id (== TrackedUser.externalId)
    const brazeId = "61fce5a2af78d01dd28f5725"; // distinct 24-hex Braze internal id

    const agent = await createAgent({ name: "Neo" });
    const msg = await createVariant(
      (await createMessage(agent.id, { brazeCampaignId: "camp_neo" })).id,
      { brazeVariantId: "var_neo" },
    );
    await createUser(youVersionId, { brazeId });

    const sentAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: youVersionId,           // decision keyed on the numeric id (as sends do)
      messageVariantId: msg.id,
      channel: "push",
      sentAt,
    });
    expect(decision.pushOpenAt).toBeNull();

    // Open event arrives keyed on the braze id only (no user_id) — the 84M-row reality.
    const res = await POST(buildRequest("POST", {
      events: [{
        event_id: `${brazeId}:${new Date().toISOString()}`,
        event_name: "push_open",
        external_user_id: brazeId,
        occurred_at: new Date().toISOString(),
        properties: { braze_user_id: brazeId },
      }],
    }, AUTH) as NextRequest);

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(1);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.pushOpenAt).not.toBeNull();
  });

  it("attributes an open for an unverified user (externalId === brazeId) via direct match", async () => {
    const brazeId = "622239c27826e74eb516fc00"; // unverified: externalId === brazeId

    const agent = await createAgent({ name: "Trinity" });
    const msg = await createVariant(
      (await createMessage(agent.id, { brazeCampaignId: "camp_trin" })).id,
      { brazeVariantId: "var_trin" },
    );
    await createUser(brazeId, { brazeId });

    const decision = await createUserDecision({
      agentId: agent.id,
      userId: brazeId,                // unverified decision keyed on the braze id
      messageVariantId: msg.id,
      channel: "push",
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const res = await POST(buildRequest("POST", {
      events: [{
        event_id: `${brazeId}:${new Date().toISOString()}`,
        event_name: "push_open",
        external_user_id: brazeId,
        occurred_at: new Date().toISOString(),
        properties: { braze_user_id: brazeId },
      }],
    }, AUTH) as NextRequest);

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.matched).toBe(1);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.pushOpenAt).not.toBeNull();
  });
});
