import { describe, expect, it } from "bun:test";
import { calculateReward } from "@/lib/engine/reward-calculator";
import type { Goal } from "@/types/agent";

/**
 * Interaction-flag eventNames are ordinary strings to the reward calculator —
 * they follow the same tier×weight formula as any other goal event.
 * The calculator has no special-case for *_has_ever_flag names.
 */
describe("calculateReward — interaction-flag eventName is treated as an ordinary event", () => {
  const flagGoals: Goal[] = [
    {
      id: "g-flag",
      agentId: "agent-1",
      eventName: "plan_interaction_has_ever_flag",
      tier: "very_good",
      valueWeight: 7,
      weightMode: "fixed",
      weightDefault: 7,
    },
  ];

  it("flag eventName with tier very_good and weight 7 → (7 × 7) / 100 = 0.49", () => {
    // TIER_BASE_REWARDS[very_good]=7; weight=7; reward = 7*7/100 = 0.49
    expect(calculateReward("plan_interaction_has_ever_flag", flagGoals)).toBeCloseTo(0.49, 5);
  });

  it("matches the reward of an ordinary event with the same tier and weight", () => {
    const ordinaryGoals: Goal[] = [
      {
        id: "g-ord",
        agentId: "agent-1",
        eventName: "plan_started",
        tier: "very_good",
        valueWeight: 7,
        weightMode: "fixed",
        weightDefault: 7,
      },
    ];
    const flagReward = calculateReward("plan_interaction_has_ever_flag", flagGoals);
    const ordinaryReward = calculateReward("plan_started", ordinaryGoals);
    expect(flagReward).toBeCloseTo(ordinaryReward, 5);
  });

  it("returns 0 when agent has no goal for the flag eventName", () => {
    expect(calculateReward("plan_interaction_has_ever_flag", [])).toBe(0);
  });

  it("returns 0 for a flag eventName not in the agent's goal list", () => {
    expect(calculateReward("votd_interaction_has_ever_flag", flagGoals)).toBe(0);
  });
});
