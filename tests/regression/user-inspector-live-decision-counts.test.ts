// tests/regression/user-inspector-live-decision-counts.test.ts
//
// REGRESSION: /api/users/[externalId] returned totalDecisions=0 even when
// UserDecision rows existed. The route was reading the denormalized
// TrackedUser.totalDecisions counter, which is only incremented by
// accumulateUserStats() (called on conversion events) — not by recordUserSend(),
// which exists but is never called. Fixed by counting UserDecision rows live.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createMessage, createVariant, createUser, createUserDecision } from "../helpers/builders";
import { GET } from "@/app/api/users/[externalId]/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

async function getUser(externalId: string) {
  const req = buildRequest("GET", undefined, {}) as NextRequest;
  return GET(req, { params: Promise.resolve({ externalId }) });
}

describe("user inspector live decision counts (regression)", () => {
  it("returns totalDecisions matching actual UserDecision rows, not denormalized counter", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);

    // Create user with stale denormalized counter (totalDecisions=0, the default)
    await createUser("usr_count_reg");

    // Create 3 decisions
    await createUserDecision({ agentId: agent.id, userId: "usr_count_reg", messageVariantId: variant.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_count_reg", messageVariantId: variant.id });
    await createUserDecision({
      agentId: agent.id,
      userId: "usr_count_reg",
      messageVariantId: variant.id,
      conversionEvent: "plan_started",
      conversionAt: new Date(),
    });

    const res = await getUser("usr_count_reg");
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { user: { totalDecisions: number; totalConversions: number } } };

    expect(data.user.totalDecisions).toBe(3);
    expect(data.user.totalConversions).toBe(1);
  });

  it("returns 0 decisions for a user with no UserDecision rows", async () => {
    await createUser("usr_nodecisions_reg");
    const res = await getUser("usr_nodecisions_reg");
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { user: { totalDecisions: number } } };
    expect(data.user.totalDecisions).toBe(0);
  });
});
