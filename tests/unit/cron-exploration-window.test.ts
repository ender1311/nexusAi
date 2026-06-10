import { describe, it, expect } from "bun:test";
import {
  buildEligibleAgentsByUser,
  classifyExplorationWindows,
  type ExplorationAgent,
  type ExplorationUser,
  type ExistingAssignment,
} from "@/lib/cron/exploration-window";

function agent(overrides: Partial<ExplorationAgent> = {}): ExplorationAgent {
  return {
    id: "agent-1",
    funnelStage: null,
    languageFilter: null,
    targetSegmentName: null,
    segmentTargeting: null,
    personaTargets: [{ personaId: "p1" }],
    messages: [{ channel: "push" }],
    ...overrides,
  };
}

function user(overrides: Partial<ExplorationUser> = {}): ExplorationUser {
  return {
    externalId: "u1",
    personaId: "p1",
    funnelStage: null,
    attributes: { language_tag: "en-US" },
    channelStats: null,
    ...overrides,
  };
}

describe("buildEligibleAgentsByUser", () => {
  it("matches users to agents by persona membership", () => {
    const res = buildEligibleAgentsByUser([agent()], [user()], "permissive");
    expect(res.get("u1")).toEqual(["agent-1"]);
  });

  it("excludes users not in the agent's persona set", () => {
    const res = buildEligibleAgentsByUser([agent()], [user({ personaId: "other" })], "permissive");
    expect(res.has("u1")).toBe(false);
  });

  it("skips users with no persona", () => {
    const res = buildEligibleAgentsByUser([agent()], [user({ personaId: null })], "permissive");
    expect(res.has("u1")).toBe(false);
  });

  it("honors push channel opt-out", () => {
    const res = buildEligibleAgentsByUser(
      [agent()],
      [user({ attributes: { language_tag: "en-US", newsletter_push_enabled: false } })],
      "permissive",
    );
    expect(res.has("u1")).toBe(false);
  });

  it("defaults push agents to English-only", () => {
    const res = buildEligibleAgentsByUser(
      [agent()],
      [user({ attributes: { language_tag: "es-MX" } })],
      "permissive",
    );
    expect(res.has("u1")).toBe(false);
  });

  it("applies funnel-stage filter when no segment targeting is active", () => {
    const a = agent({ funnelStage: "lapsed_dau" });
    expect(buildEligibleAgentsByUser([a], [user({ funnelStage: "active" })], "permissive").has("u1")).toBe(false);
    expect(buildEligibleAgentsByUser([a], [user({ funnelStage: "lapsed_dau" })], "permissive").get("u1")).toEqual(["agent-1"]);
  });

  it("skips funnel-stage filter when segment includes are present", () => {
    const a = agent({ funnelStage: "lapsed_dau", segmentTargeting: { includes: ["seg-1"] } });
    expect(buildEligibleAgentsByUser([a], [user({ funnelStage: "active" })], "permissive").get("u1")).toEqual(["agent-1"]);
  });

  it("strict mode excludes push agent when preferred external channel is not push", () => {
    const a = agent({ funnelStage: "lapsed_dau" });
    const u = user({
      funnelStage: "lapsed_dau",
      attributes: { language_tag: "en-US", preferred_channel_external_90_days: "email" },
    });
    expect(buildEligibleAgentsByUser([a], [u], "strict").has("u1")).toBe(false);
    expect(buildEligibleAgentsByUser([a], [u], "broad").get("u1")).toEqual(["agent-1"]);
  });
});

describe("classifyExplorationWindows", () => {
  const opts = {
    now: new Date("2026-05-30T12:00:00Z"),
    windowMs: 8 * 24 * 60 * 60 * 1000,
    cooldownMs: 30 * 24 * 60 * 60 * 1000,
    pickAgent: (ids: string[]) => ids[0],
  };

  it("Class A — newly eligible user with no assignment is created", () => {
    const res = classifyExplorationWindows(
      [user()],
      new Map(),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.toCreate).toEqual([{ externalUserId: "u1", agentId: "agent-1" }]);
    expect(res.inWindowMap.get("u1")).toBe("agent-1");
  });

  it("Class B — active window stays locked", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-05-29T12:00:00Z"),
      windowCompletedAt: null,
      releasedAt: null,
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map(),
      opts,
    );
    expect(res.toCreate).toHaveLength(0);
    expect(res.toClose).toHaveLength(0);
    expect(res.inWindowMap.get("u1")).toBe("agent-1");
  });

  it("Class C — expired window without completion is closed", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-05-01T12:00:00Z"),
      windowCompletedAt: null,
      releasedAt: null,
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map(),
      opts,
    );
    expect(res.toClose).toEqual(["a1"]);
    expect(res.inWindowMap.has("u1")).toBe(false);
  });

  it("Class D — completed window past cooldown starts fresh", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-01-01T12:00:00Z"),
      windowCompletedAt: new Date("2026-01-10T12:00:00Z"),
      releasedAt: null,
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.toReset).toEqual([{ externalUserId: "u1", agentId: "agent-1" }]);
    expect(res.inWindowMap.get("u1")).toBe("agent-1");
  });

  // 2026-06-09 audit, C3: released assignments must never classify as an active
  // window — the release sweep ended ownership, so continuing to send is a bug.
  it("released assignment is never an active window, even inside the 8-day span", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-05-29T12:00:00Z"), // 1 day old — would be Class B if not released
      windowCompletedAt: null,
      releasedAt: new Date("2026-05-29T18:00:00Z"),
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.inWindowMap.has("u1")).toBe(false);
    expect(res.toCreate).toHaveLength(0);
    expect(res.toReset).toHaveLength(0);
    expect(res.toClose).toHaveLength(0);
  });

  it("released assignment re-enters via a fresh window only after cooldown from releasedAt", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-01-01T12:00:00Z"),
      windowCompletedAt: null,
      releasedAt: new Date("2026-04-01T12:00:00Z"), // ~59 days before now > 30-day cooldown
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.toReset).toEqual([{ externalUserId: "u1", agentId: "agent-1" }]);
    expect(res.inWindowMap.get("u1")).toBe("agent-1");
  });

  it("released assignment with an expired, never-closed window is closed but not re-entered", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-05-15T12:00:00Z"), // 15 days old > 8-day window
      windowCompletedAt: null,
      releasedAt: new Date("2026-05-29T12:00:00Z"), // 1 day ago < 30-day cooldown
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.toClose).toEqual(["a1"]); // bookkeeping: the window ran its course
    expect(res.inWindowMap.has("u1")).toBe(false);
    expect(res.toCreate).toHaveLength(0);
    expect(res.toReset).toHaveLength(0);
  });

  it("released assignment within cooldown takes no action even if windowCompletedAt is stale", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-01-01T12:00:00Z"),
      // Completed long ago — without the released branch this would be Class D.
      windowCompletedAt: new Date("2026-01-10T12:00:00Z"),
      releasedAt: new Date("2026-05-25T12:00:00Z"), // 5 days ago < 30-day cooldown
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.toCreate).toHaveLength(0);
    expect(res.toReset).toHaveLength(0);
    expect(res.toClose).toHaveLength(0);
    expect(res.inWindowMap.has("u1")).toBe(false);
  });

  it("Class E — completed window within cooldown takes no action", () => {
    const assignment: ExistingAssignment = {
      id: "a1",
      externalUserId: "u1",
      agentId: "agent-1",
      startedAt: new Date("2026-05-01T12:00:00Z"),
      windowCompletedAt: new Date("2026-05-20T12:00:00Z"),
      releasedAt: null,
    };
    const res = classifyExplorationWindows(
      [user()],
      new Map([["u1", assignment]]),
      new Map([["u1", ["agent-1"]]]),
      opts,
    );
    expect(res.toCreate).toHaveLength(0);
    expect(res.toReset).toHaveLength(0);
    expect(res.toClose).toHaveLength(0);
    expect(res.inWindowMap.has("u1")).toBe(false);
  });
});
