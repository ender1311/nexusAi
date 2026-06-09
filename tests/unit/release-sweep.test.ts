import { describe, it, expect } from "bun:test";
import { classifyReleases, type ReleaseAgentInfo, type ActiveAssignment } from "@/lib/cron/release-sweep";

const BASE_AGENT: ReleaseAgentInfo = {
  id: "agent-1",
  holdMaxDays: 30,
  holdMaxSends: 10,
  targetStages: new Set<string>(),
  enrollmentMode: "fixed",
};

const NOW = new Date("2024-06-01T12:00:00Z");
const RECENT = new Date("2024-05-25T12:00:00Z"); // 7 days ago — well within cap

function makeAssignment(overrides: Partial<ActiveAssignment> = {}): ActiveAssignment {
  return {
    id: "assign-1",
    externalUserId: "user-1",
    agentId: "agent-1",
    startedAt: RECENT,
    sendCount: 0,
    currentStage: "wau",
    ...overrides,
  };
}

function makeAgentsById(agent: ReleaseAgentInfo): Map<string, ReleaseAgentInfo> {
  return new Map([[agent.id, agent]]);
}

// ──────────────────────────────────────────────────────────────────────────────
// cohort_exit
// ──────────────────────────────────────────────────────────────────────────────

describe("cohort_exit", () => {
  it("releases when user stage not in targetStages", () => {
    const agent: ReleaseAgentInfo = { ...BASE_AGENT, targetStages: new Set(["dau4"]) };
    const a = makeAssignment({ currentStage: "wau" });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("cohort_exit");
  });

  it("does not release when user stage is in targetStages", () => {
    const agent: ReleaseAgentInfo = { ...BASE_AGENT, targetStages: new Set(["wau"]) };
    const a = makeAssignment({ currentStage: "wau" });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    expect(result).toHaveLength(0);
  });

  it("does not release when targetStages is empty", () => {
    const a = makeAssignment();
    const result = classifyReleases([a], makeAgentsById(BASE_AGENT), NOW);
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// hold_cap_days
// ──────────────────────────────────────────────────────────────────────────────

describe("hold_cap_days", () => {
  it("releases when hold duration exceeded", () => {
    const a = makeAssignment({
      startedAt: new Date("2024-04-01T00:00:00Z"), // 61 days ago
    });
    const result = classifyReleases([a], makeAgentsById(BASE_AGENT), NOW);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("hold_cap_days");
  });

  it("does not release when hold duration not exceeded", () => {
    const a = makeAssignment();
    const result = classifyReleases([a], makeAgentsById(BASE_AGENT), NOW);
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// hold_cap_sends
// ──────────────────────────────────────────────────────────────────────────────

describe("hold_cap_sends", () => {
  it("releases when sendCount meets cap", () => {
    const a = makeAssignment({ sendCount: 10 });
    const result = classifyReleases([a], makeAgentsById(BASE_AGENT), NOW);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("hold_cap_sends");
  });

  it("does not release when sendCount below cap", () => {
    const a = makeAssignment({ sendCount: 5 });
    const result = classifyReleases([a], makeAgentsById(BASE_AGENT), NOW);
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// missing agent
// ──────────────────────────────────────────────────────────────────────────────

describe("missing agent", () => {
  it("skips assignment when agent not found in map", () => {
    const a = makeAssignment({ agentId: "nonexistent" });
    const result = classifyReleases([a], makeAgentsById(BASE_AGENT), NOW);
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// segment_exit (continuous enrollment)
// ──────────────────────────────────────────────────────────────────────────────

describe("segment_exit", () => {
  it("releases user not in audience of a continuous agent", () => {
    const agent: ReleaseAgentInfo = {
      ...BASE_AGENT,
      enrollmentMode: "continuous",
      audience: new Set(["user-other"]),
    };
    const a = makeAssignment({ externalUserId: "user-1" });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("segment_exit");
    expect(result[0].externalUserId).toBe("user-1");
  });

  it("does not release user who is in the audience of a continuous agent", () => {
    const agent: ReleaseAgentInfo = {
      ...BASE_AGENT,
      enrollmentMode: "continuous",
      audience: new Set(["user-1"]),
    };
    const a = makeAssignment({ externalUserId: "user-1" });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    expect(result).toHaveLength(0);
  });

  it("fixed agent never produces segment_exit even if audience provided", () => {
    const agent: ReleaseAgentInfo = {
      ...BASE_AGENT,
      enrollmentMode: "fixed",
      audience: new Set(["user-other"]),
    };
    const a = makeAssignment({ externalUserId: "user-1" });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    // user-1 not in audience but agent is fixed — no segment_exit
    expect(result.some((r) => r.reason === "segment_exit")).toBe(false);
  });

  it("continuous agent with undefined audience produces no segment_exit", () => {
    const agent: ReleaseAgentInfo = {
      ...BASE_AGENT,
      enrollmentMode: "continuous",
      audience: undefined,
    };
    const a = makeAssignment({ externalUserId: "user-1" });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    expect(result.some((r) => r.reason === "segment_exit")).toBe(false);
  });

  it("other release reasons still apply for users in audience of continuous agent", () => {
    const agent: ReleaseAgentInfo = {
      ...BASE_AGENT,
      enrollmentMode: "continuous",
      audience: new Set(["user-1"]),
      holdMaxSends: 3,
    };
    const a = makeAssignment({ externalUserId: "user-1", sendCount: 3 });
    const result = classifyReleases([a], makeAgentsById(agent), NOW);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("hold_cap_sends");
  });
});
