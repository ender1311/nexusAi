import { describe, expect, it } from "bun:test";
import { classifyReleases } from "@/lib/cron/release-sweep";

const now = new Date("2026-05-31T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const agent = { id: "a1", holdMaxDays: 90, holdMaxSends: 24, targetStages: new Set(["lapsed_mau"]), enrollmentMode: "fixed" as const };

describe("classifyReleases", () => {
  it("releases hold_cap_days at 91 days, keeps at 89", () => {
    const r = classifyReleases(
      [
        { id: "x", externalUserId: "u1", agentId: "a1", startedAt: daysAgo(91), sendCount: 0, currentStage: "lapsed_mau" },
        { id: "y", externalUserId: "u2", agentId: "a1", startedAt: daysAgo(89), sendCount: 0, currentStage: "lapsed_mau" },
      ],
      new Map([["a1", agent]]),
      now,
    );
    expect(r.find((e) => e.id === "x")?.reason).toBe("hold_cap_days");
    expect(r.find((e) => e.id === "y")).toBeUndefined();
  });

  it("releases hold_cap_sends at 24, keeps at 23", () => {
    const r = classifyReleases(
      [
        { id: "x", externalUserId: "u1", agentId: "a1", startedAt: daysAgo(1), sendCount: 24, currentStage: "lapsed_mau" },
        { id: "y", externalUserId: "u2", agentId: "a1", startedAt: daysAgo(1), sendCount: 23, currentStage: "lapsed_mau" },
      ],
      new Map([["a1", agent]]),
      now,
    );
    expect(r.find((e) => e.id === "x")?.reason).toBe("hold_cap_sends");
    expect(r.find((e) => e.id === "y")).toBeUndefined();
  });

  it("releases cohort_exit when current stage no longer matches the agent target", () => {
    const r = classifyReleases(
      [{ id: "x", externalUserId: "u1", agentId: "a1", startedAt: daysAgo(1), sendCount: 0, currentStage: "dau4" }],
      new Map([["a1", agent]]),
      now,
    );
    expect(r.find((e) => e.id === "x")?.reason).toBe("cohort_exit");
  });

  it("does not release a healthy in-cohort assignment", () => {
    const r = classifyReleases(
      [{ id: "x", externalUserId: "u1", agentId: "a1", startedAt: daysAgo(1), sendCount: 1, currentStage: "lapsed_mau" }],
      new Map([["a1", agent]]),
      now,
    );
    expect(r).toHaveLength(0);
  });

  it("skips assignments whose owning agent is missing (deleted/paused)", () => {
    const r = classifyReleases(
      [{ id: "x", externalUserId: "u1", agentId: "ghost", startedAt: daysAgo(999), sendCount: 99, currentStage: "x" }],
      new Map([["a1", agent]]),
      now,
    );
    expect(r).toHaveLength(0);
  });
});

describe("segment_exit (continuous enrollment)", () => {
  const assignment = { id: "x", externalUserId: "u1", agentId: "a1", startedAt: daysAgo(1), sendCount: 0, currentStage: "lapsed_mau" };

  it("releases a user no longer in the audience of a continuous agent", () => {
    const continuous = { ...agent, enrollmentMode: "continuous" as const, audience: new Set(["u-other"]) };
    const r = classifyReleases([assignment], new Map([["a1", continuous]]), now);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("segment_exit");
    expect(r[0].externalUserId).toBe("u1");
  });

  it("does not release a user who is still in the audience", () => {
    const continuous = { ...agent, enrollmentMode: "continuous" as const, audience: new Set(["u1"]) };
    const r = classifyReleases([assignment], new Map([["a1", continuous]]), now);
    expect(r).toHaveLength(0);
  });

  it("fixed agent never produces segment_exit even if an audience is provided", () => {
    const fixedWithAudience = { ...agent, audience: new Set(["u-other"]) };
    const r = classifyReleases([assignment], new Map([["a1", fixedWithAudience]]), now);
    expect(r.some((e) => e.reason === "segment_exit")).toBe(false);
  });

  it("continuous agent with no audience set produces no segment_exit", () => {
    const continuous = { ...agent, enrollmentMode: "continuous" as const };
    const r = classifyReleases([assignment], new Map([["a1", continuous]]), now);
    expect(r.some((e) => e.reason === "segment_exit")).toBe(false);
  });

  it("other release reasons still apply to users in the audience", () => {
    const continuous = { ...agent, enrollmentMode: "continuous" as const, audience: new Set(["u1"]) };
    const r = classifyReleases([{ ...assignment, sendCount: 24 }], new Map([["a1", continuous]]), now);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("hold_cap_sends");
  });
});
