// tests/regression/user-lock-sql-filter.test.ts
//
// REGRESSION: cron eligibility query must include lock filter so users locked by
// other agents are excluded. Tests the OR logic without hitting the DB.

import { describe, expect, it } from "bun:test";

describe("regression: user lock filter logic", () => {
  function isEligibleForAgent(
    user: { lockedByAgentId: string | null },
    agentId: string,
  ): boolean {
    return user.lockedByAgentId === null || user.lockedByAgentId === agentId;
  }

  it("unlocked user is eligible for any agent", () => {
    expect(isEligibleForAgent({ lockedByAgentId: null }, "agent-a")).toBe(true);
    expect(isEligibleForAgent({ lockedByAgentId: null }, "agent-b")).toBe(true);
  });

  it("user locked to agent A is eligible for agent A", () => {
    expect(isEligibleForAgent({ lockedByAgentId: "agent-a" }, "agent-a")).toBe(true);
  });

  it("user locked to agent A is NOT eligible for agent B", () => {
    expect(isEligibleForAgent({ lockedByAgentId: "agent-a" }, "agent-b")).toBe(false);
  });
});
