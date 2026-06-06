import { describe, expect, it } from "bun:test";
import { calculateReward, calculateCumulativeReward } from "@/lib/engine/reward-calculator";
import type { Goal } from "@/types/agent";

// TIER_BASE_REWARDS: best=10, very_good=7, good=5, bad=-2, very_bad=-5, worst=-10
const goals: Goal[] = [
  { id: "g1", agentId: "a1", eventName: "plan_started",  tier: "best",     valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g2", agentId: "a1", eventName: "app_open",      tier: "good",     valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g3", agentId: "a1", eventName: "very_good_ev",  tier: "very_good",valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g4", agentId: "a1", eventName: "bad_ev",        tier: "bad",      valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g5", agentId: "a1", eventName: "very_bad_ev",   tier: "very_bad", valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g6", agentId: "a1", eventName: "unsubscribe",   tier: "worst",    valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  // Property-based: amount multiplies base reward
  { id: "g7", agentId: "a1", eventName: "donation",      tier: "best",     valueWeight: 1.0, weightMode: "property", weightDefault: 0.5, weightProperty: "amount" },
];

describe("calculateReward", () => {
  it("tier 'best' weight 1.0 → 0.1", () => {
    expect(calculateReward("plan_started", goals)).toBeCloseTo(0.1, 5);
  });

  it("tier 'very_good' weight 1.0 → 0.07", () => {
    expect(calculateReward("very_good_ev", goals)).toBeCloseTo(0.07, 5);
  });

  it("tier 'good' weight 1.0 → 0.05", () => {
    expect(calculateReward("app_open", goals)).toBeCloseTo(0.05, 5);
  });

  it("tier 'bad' weight 1.0 → -0.02", () => {
    expect(calculateReward("bad_ev", goals)).toBeCloseTo(-0.02, 5);
  });

  it("tier 'very_bad' weight 1.0 → -0.05", () => {
    expect(calculateReward("very_bad_ev", goals)).toBeCloseTo(-0.05, 5);
  });

  it("tier 'worst' weight 1.0 → -0.1", () => {
    expect(calculateReward("unsubscribe", goals)).toBeCloseTo(-0.1, 5);
  });

  it("unknown event → 0", () => {
    expect(calculateReward("random_event", goals)).toBe(0);
  });

  it("empty goals → 0", () => {
    expect(calculateReward("plan_started", [])).toBe(0);
  });

  it("property weight mode uses event property value", () => {
    // best(10) * amount(3) / 100 = 0.3
    expect(calculateReward("donation", goals, { amount: 3 })).toBeCloseTo(0.3, 5);
  });

  it("property weight mode falls back to weightDefault when property missing", () => {
    // best(10) * weightDefault(0.5) / 100 = 0.05
    expect(calculateReward("donation", goals, {})).toBeCloseTo(0.05, 5);
  });

  it("property weight mode falls back to weightDefault when property is null", () => {
    // Number(null) === 0, which would zero the reward; must fall back instead.
    // best(10) * weightDefault(0.5) / 100 = 0.05
    expect(calculateReward("donation", goals, { amount: null })).toBeCloseTo(0.05, 5);
  });

  it("property weight mode falls back to weightDefault when property is empty string", () => {
    // Number("") === 0, which would zero the reward; must fall back instead.
    // best(10) * weightDefault(0.5) / 100 = 0.05
    expect(calculateReward("donation", goals, { amount: "" })).toBeCloseTo(0.05, 5);
  });

  it("property weight mode falls back to weightDefault when property is whitespace", () => {
    // Number("  ") === 0; must fall back instead.
    expect(calculateReward("donation", goals, { amount: "   " })).toBeCloseTo(0.05, 5);
  });

  it("property weight mode falls back to weightDefault when property is non-numeric string", () => {
    // Number("abc") === NaN; must fall back instead.
    expect(calculateReward("donation", goals, { amount: "abc" })).toBeCloseTo(0.05, 5);
  });

  it("property weight mode accepts a numeric string", () => {
    // best(10) * Number("3")(3) / 100 = 0.3
    expect(calculateReward("donation", goals, { amount: "3" })).toBeCloseTo(0.3, 5);
  });

  it("property weight mode treats explicit 0 as a real value (not a fallback)", () => {
    // best(10) * 0 / 100 = 0 — a genuine zero, distinct from the missing-property case.
    expect(calculateReward("donation", goals, { amount: 0 })).toBe(0);
  });

  it("clamps to +1.0 maximum", () => {
    const bigGoals: Goal[] = [
      { id: "g1", agentId: "a1", eventName: "purchase", tier: "best", valueWeight: 500, weightMode: "fixed", weightDefault: 1.0 },
    ];
    expect(calculateReward("purchase", bigGoals)).toBe(1.0);
  });

  it("clamps to -1.0 minimum", () => {
    const bigGoals: Goal[] = [
      { id: "g1", agentId: "a1", eventName: "churn", tier: "worst", valueWeight: 500, weightMode: "fixed", weightDefault: 1.0 },
    ];
    expect(calculateReward("churn", bigGoals)).toBe(-1.0);
  });
});

describe("calculateCumulativeReward", () => {
  it("sums rewards across multiple events", () => {
    // plan_started(0.1) + app_open(0.05) = 0.15
    expect(calculateCumulativeReward(["plan_started", "app_open"], goals)).toBeCloseTo(0.15, 5);
  });

  it("returns 0 for empty events array", () => {
    expect(calculateCumulativeReward([], goals)).toBe(0);
  });

  it("unknown events contribute 0", () => {
    expect(calculateCumulativeReward(["plan_started", "unknown"], goals)).toBeCloseTo(0.1, 5);
  });
});

describe("gift_given amount-weighted reward", () => {
  const giftGoals: Goal[] = [
    { id: "gg", agentId: "a1", eventName: "gift_given", tier: "best", valueWeight: 10, weightMode: "fixed", weightDefault: 1.0 },
  ];

  // reward = clamp((tierBase/10) * log10(1+usd)/log10(1+1000), 0, 1); tierBase(best)=10
  it("$5 ≈ 0.26", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 5 })).toBeCloseTo(0.26, 2);
  });
  it("$50 ≈ 0.57", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 50 })).toBeCloseTo(0.57, 2);
  });
  it("$500 ≈ 0.90", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 500 })).toBeCloseTo(0.90, 2);
  });
  it("$1000 caps at 1.0", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 1000 })).toBeCloseTo(1.0, 5);
  });
  it("above the cap still clamps to 1.0", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 5000 })).toBe(1);
  });
  it("$0 or missing amount → 0", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 0 })).toBe(0);
    expect(calculateReward("gift_given", giftGoals, {})).toBe(0);
  });

  it("a non-best tier scales the reward down proportionally", () => {
    const goodGiftGoals: Goal[] = [
      { id: "gg2", agentId: "a1", eventName: "gift_given", tier: "good", valueWeight: 10, weightMode: "fixed", weightDefault: 1.0 },
    ];
    // tierBase(good)=5 → half of the best-tier reward for the same amount
    expect(calculateReward("gift_given", goodGiftGoals, { gift_amount_usd: 1000 })).toBeCloseTo(0.5, 5);
  });

  it("returns 0 when the agent has no gift_given goal", () => {
    expect(calculateReward("gift_given", [], { gift_amount_usd: 100 })).toBe(0);
  });
});

describe("sower_subscribed flat-max reward", () => {
  it("returns flat 1.0 when the agent has a sower_subscribed goal", () => {
    const sowerGoals: Goal[] = [
      { id: "sg", agentId: "a1", eventName: "sower_subscribed", tier: "best", valueWeight: 10, weightMode: "fixed", weightDefault: 1.0 },
    ];
    expect(calculateReward("sower_subscribed", sowerGoals)).toBe(1.0);
  });

  it("ignores the configured tier — always 1.0 (a recurring commitment is the top signal)", () => {
    const lowTierGoals: Goal[] = [
      { id: "sg2", agentId: "a1", eventName: "sower_subscribed", tier: "good", valueWeight: 1, weightMode: "fixed", weightDefault: 1.0 },
    ];
    expect(calculateReward("sower_subscribed", lowTierGoals)).toBe(1.0);
  });

  it("returns 0 when the agent has no sower_subscribed goal (must opt in)", () => {
    expect(calculateReward("sower_subscribed", [])).toBe(0);
  });
});
