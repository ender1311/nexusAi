import { describe, expect, it } from "bun:test";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";

describe("EpsilonGreedy", () => {
  it("throws when arms array is empty", () => {
    expect(() => new EpsilonGreedy().select([])).toThrow("No arms to select from");
  });

  it("exploits best arm when epsilon=0", () => {
    const eg = new EpsilonGreedy(0);
    const arms = [
      { id: "best", stats: { alpha: 8, beta: 2, tries: 10, wins: 8 } },
      { id: "worst", stats: { alpha: 2, beta: 8, tries: 10, wins: 2 } },
    ];
    // With ε=0 always exploits: best empirical rate wins every time
    for (let i = 0; i < 20; i++) {
      expect(eg.select(arms).variantId).toBe("best");
    }
  });

  it("explores (returns explore=true) roughly ε fraction of the time", () => {
    const eg = new EpsilonGreedy(0.3);
    const arms = [
      { id: "v1", stats: { alpha: 10, beta: 0, tries: 10, wins: 10 } },
      { id: "v2", stats: { alpha: 0, beta: 10, tries: 10, wins: 0 } },
    ];
    const results = Array.from({ length: 1000 }, () => eg.select(arms));
    const exploreCount = results.filter(r => r.explore).length;
    // Should be approximately 30% ± 5%
    expect(exploreCount).toBeGreaterThan(200);
    expect(exploreCount).toBeLessThan(400);
  });

});
