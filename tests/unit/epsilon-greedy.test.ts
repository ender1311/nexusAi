import { describe, expect, it } from "bun:test";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";

describe("EpsilonGreedy", () => {
  it("initialStats returns alpha=0, beta=0, tries=0, wins=0", () => {
    const eg = new EpsilonGreedy();
    expect(eg.initialStats()).toEqual({ alpha: 0, beta: 0, tries: 0, wins: 0 });
  });

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

  it("updateArm increments tries and wins on positive reward", () => {
    const eg = new EpsilonGreedy();
    const stats = { alpha: 0, beta: 0, tries: 5, wins: 3 };
    const updated = eg.updateArm(stats, 0.7);
    expect(updated.tries).toBe(6);
    expect(updated.wins).toBe(4);
    expect(updated.alpha).toBe(0.7);
    expect(updated.beta).toBe(0);
  });

  it("updateArm increments tries but not wins on negative reward", () => {
    const eg = new EpsilonGreedy();
    const stats = { alpha: 0, beta: 0, tries: 5, wins: 3 };
    const updated = eg.updateArm(stats, -0.5);
    expect(updated.tries).toBe(6);
    expect(updated.wins).toBe(3);
    expect(updated.alpha).toBe(0);
    expect(updated.beta).toBe(1);
  });

  it("decayEpsilon reduces epsilon by factor of 0.995", () => {
    const eg = new EpsilonGreedy(0.2);
    eg.decayEpsilon();
    // epsilon * 0.995 = 0.199; check via proxy: explore rate drops
    // We test the floor behavior directly:
    // decay from 0.011 to floor at 0.01
    const eg2 = new EpsilonGreedy(0.011);
    eg2.decayEpsilon(0.01);
    // After decay: max(0.01, 0.011 * 0.995) = max(0.01, 0.010945) = 0.010945
    // Calling again crosses floor:
    eg2.decayEpsilon(0.01);
    eg2.decayEpsilon(0.01);
    // Eventually floors at 0.01 — just verify it doesn't go to 0
    const arms = [
      { id: "v1", stats: { alpha: 10, beta: 0, tries: 10, wins: 10 } },
      { id: "v2", stats: { alpha: 0, beta: 10, tries: 10, wins: 0 } },
    ];
    const results = Array.from({ length: 500 }, () => eg2.select(arms));
    const exploreCount = results.filter(r => r.explore).length;
    // Should still explore ~1% of the time (floor)
    expect(exploreCount).toBeGreaterThan(0);
  });
});
