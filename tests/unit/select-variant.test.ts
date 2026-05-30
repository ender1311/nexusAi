import { describe, it, expect } from "bun:test";
import { selectVariant } from "@/lib/engine/select-variant";
import type { BanditArm } from "@/lib/engine/types";

describe("selectVariant — pure algorithm dispatch", () => {
  it("returns null when thompson has no arms", () => {
    expect(selectVariant({ algorithm: "thompson", arms: [] })).toBeNull();
  });

  it("returns null when epsilon_greedy has no arms", () => {
    expect(selectVariant({ algorithm: "epsilon_greedy", arms: [], epsilon: 0.1 })).toBeNull();
  });

  it("returns null when linucb has no arms", () => {
    expect(selectVariant({ algorithm: "linucb", linucbArms: [], context: [1, 0] })).toBeNull();
  });

  it("thompson returns one of the provided arm ids", () => {
    const arms: BanditArm[] = [
      { id: "a", stats: { alpha: 50, beta: 5, tries: 55, wins: 50 } },
      { id: "b", stats: { alpha: 1, beta: 30, tries: 31, wins: 1 } },
    ];
    const picked = selectVariant({ algorithm: "thompson", arms });
    expect(picked).not.toBeNull();
    expect(["a", "b"]).toContain(picked!);
  });

  it("epsilon_greedy with epsilon=0 always exploits the highest empirical rate", () => {
    const arms: BanditArm[] = [
      { id: "low", stats: { alpha: 1, beta: 1, tries: 10, wins: 1 } },
      { id: "high", stats: { alpha: 1, beta: 1, tries: 10, wins: 9 } },
    ];
    for (let i = 0; i < 20; i++) {
      expect(selectVariant({ algorithm: "epsilon_greedy", arms, epsilon: 0 })).toBe("high");
    }
  });

  it("linucb selects from the provided arms given a context vector", () => {
    // 2-dim identity priors (A=I, b=0) — both arms score 0 + exploration bonus, tie-broken at random.
    const linucbArms = [
      { id: "x", aInv: [1, 0, 0, 1], b: [0, 0] },
      { id: "y", aInv: [1, 0, 0, 1], b: [0, 0] },
    ];
    const picked = selectVariant({ algorithm: "linucb", linucbArms, context: [1, 1] });
    expect(picked).not.toBeNull();
    expect(["x", "y"]).toContain(picked!);
  });

  it("linucb prefers the arm whose learned model predicts higher reward", () => {
    // Arm 'good' has b aligned with context (positive exploit term); 'bad' is anti-aligned.
    const linucbArms = [
      { id: "good", aInv: [1, 0, 0, 1], b: [5, 5] },
      { id: "bad", aInv: [1, 0, 0, 1], b: [-5, -5] },
    ];
    const picked = selectVariant({ algorithm: "linucb", linucbArms, context: [1, 1] });
    expect(picked).toBe("good");
  });
});
