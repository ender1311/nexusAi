// tests/regression/agent-cohort-giving-column.test.ts
//
// REGRESSION: agentCohortGiving (src/lib/cache/agent-giving.ts) runs a $queryRawUnsafe
// that joins "UserAgentAssignment"."externalUserId" → "User"."externalId" and parses
// giving attributes out of the User.attributes JSON. A wrong column name (e.g.
// "userId" instead of "externalUserId", or the wrong attribute key) would throw at
// render time on the agent Performance tab. This pins the exact column/attribute
// names and the active-cohort scoping (releasedAt IS NULL).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createAgent, createUser, createUserAgentAssignment } from "../helpers/builders";
import { agentCohortGiving } from "@/lib/cache/agent-giving";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agentCohortGiving cohort giving SQL", () => {
  it("aggregates giving attributes over the active (non-released) cohort", async () => {
    const agent = await createAgent({ name: "Solomon-test" });

    // Two givers (one recurring), one non-giver — all actively assigned.
    await createUser("giver-1", {
      attributes: { gift_count_lifetime: 5, gift_amount_lifetime: 120, gift_amount_maximum: 50, has_recurring_gift: true },
    });
    await createUser("giver-2", {
      attributes: { gift_count_lifetime: 2, gift_amount_lifetime: 30, gift_amount_maximum: 20, has_recurring_gift: false },
    });
    await createUser("nongiver-1", { attributes: {} });
    // A giver who has been RELEASED — must be excluded from the active cohort.
    await createUser("released-giver", {
      attributes: { gift_count_lifetime: 99, gift_amount_lifetime: 9999, gift_amount_maximum: 500, has_recurring_gift: true },
    });

    await createUserAgentAssignment({ externalUserId: "giver-1", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "giver-2", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "nongiver-1", agentId: agent.id });
    await createUserAgentAssignment({ externalUserId: "released-giver", agentId: agent.id, releasedAt: new Date() });

    const c = await agentCohortGiving(agent.id);

    expect(c.assigned).toBe(3); // released-giver excluded
    expect(c.givers).toBe(2);
    expect(c.recurringGivers).toBe(1);
    expect(c.lifetimeGiftCount).toBe(7); // 5 + 2
    expect(c.lifetimeGivingReported).toBe(150); // 120 + 30
    expect(c.avgMaxGiftReported).toBe(35); // (50 + 20) / 2
  });

  it("returns zeroes for an agent with no assignments", async () => {
    const agent = await createAgent({ name: "Empty-test" });
    const c = await agentCohortGiving(agent.id);
    expect(c.assigned).toBe(0);
    expect(c.givers).toBe(0);
  });
});
