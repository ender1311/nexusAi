import { describe, expect, it } from "bun:test";
import { calculateReward } from "@/lib/engine/reward-calculator";
import type { Goal } from "@/types/agent";

const closeTo = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9);

describe("calculateReward — funnel_recovery built-in", () => {
  it("rewards by destination rank: mau=0.25, wau=0.35, dau4=0.50", () => {
    closeTo(calculateReward("funnel_recovery", [], { recovery_rank: 1 }), 0.25);
    closeTo(calculateReward("funnel_recovery", [], { recovery_rank: 2 }), 0.35);
    closeTo(calculateReward("funnel_recovery", [], { recovery_rank: 3 }), 0.5);
  });

  it("is monotonic in rank (mau < wau < dau4)", () => {
    const mau = calculateReward("funnel_recovery", [], { recovery_rank: 1 });
    const wau = calculateReward("funnel_recovery", [], { recovery_rank: 2 });
    const dau4 = calculateReward("funnel_recovery", [], { recovery_rank: 3 });
    expect(mau).toBeLessThan(wau);
    expect(wau).toBeLessThan(dau4);
  });

  it("returns 0 when recovery_rank is missing or invalid", () => {
    expect(calculateReward("funnel_recovery", [])).toBe(0);
    expect(calculateReward("funnel_recovery", [], {})).toBe(0);
    expect(calculateReward("funnel_recovery", [], { recovery_rank: 0 })).toBe(0);
    expect(calculateReward("funnel_recovery", [], { recovery_rank: 99 })).toBe(0);
  });

  it("an explicit agent Goal for funnel_recovery overrides the built-in", () => {
    const goals: Goal[] = [
      { id: "g1", agentId: "a1", eventName: "funnel_recovery", tier: "best",
        valueWeight: 100, weightMode: "fixed", weightProperty: null, weightDefault: 1, description: null },
    ];
    // best(10) * 100 / 100 = 10, clamped to 1
    expect(calculateReward("funnel_recovery", goals, { recovery_rank: 1 })).toBe(1);
  });
});
