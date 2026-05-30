import { describe, expect, it } from "bun:test";
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";

describe("ThompsonSampling", () => {
  const ts = new ThompsonSampling();

  it("throws when arms array is empty", () => {
    expect(() => ts.select([])).toThrow("No arms to select from");
  });

  it("returns the only arm when given one arm", () => {
    const result = ts.select([{ id: "v1", stats: { alpha: 1, beta: 1, tries: 0, wins: 0 } }]);
    expect(result.variantId).toBe("v1");
    expect(result.explore).toBe(false); // only arm = greedy arm
  });

  it("favors the high-win-rate arm in 1000 draws (>80%)", () => {
    const arms = [
      { id: "winner", stats: { alpha: 90, beta: 10, tries: 100, wins: 90 } },
      { id: "loser", stats: { alpha: 10, beta: 90, tries: 100, wins: 10 } },
    ];
    let winCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms).variantId === "winner") winCount++;
    }
    expect(winCount).toBeGreaterThan(800);
  });

  it("result.explore is true when a non-greedy arm is chosen", () => {
    // v1 has far more tries (is the greedy arm); if v2 is chosen, explore=true
    const arms = [
      { id: "v1", stats: { alpha: 1, beta: 1, tries: 1000, wins: 500 } },
      { id: "v2", stats: { alpha: 1, beta: 1, tries: 0, wins: 0 } },
    ];
    const results = Array.from({ length: 200 }, () => ts.select(arms));
    const v2Results = results.filter(r => r.variantId === "v2");
    for (const r of v2Results) {
      expect(r.explore).toBe(true);
    }
  });

  it("recency penalty reduces selection probability of penalised arm", () => {
    // With penalty 0.1 on "winner", "loser" should win far more often
    const arms = [
      { id: "winner", stats: { alpha: 90, beta: 10, tries: 100, wins: 90 } },
      { id: "loser",  stats: { alpha: 10, beta: 90, tries: 100, wins: 10 } },
    ];
    // 0.1 penalty is required here, not 0.5. At 0.5, winner's adjusted mean ≈ 0.9×0.5=0.45,
    // still far above loser's mean of ~0.1. Only at 0.1 does the adjustment reliably
    // invert selection. In production, recencyMultiplier() floors at 0.2 (day=0 → 0.74).
    const penalties = { winner: 0.1 };
    let loserCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms, penalties).variantId === "loser") loserCount++;
    }
    // Without penalty, loser wins <20% of the time. With penalty on winner, loser should win >50%.
    expect(loserCount).toBeGreaterThan(500);
  });

  it("select without recencyPenalties behaves identically to original (no regression)", () => {
    const arms = [
      { id: "v1", stats: { alpha: 80, beta: 20, tries: 100, wins: 80 } },
      { id: "v2", stats: { alpha: 20, beta: 80, tries: 100, wins: 20 } },
    ];
    let v1Count = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms).variantId === "v1") v1Count++;
    }
    expect(v1Count).toBeGreaterThan(800);
  });

  it("penalty of 1.0 has no effect on selection", () => {
    const arms = [
      { id: "winner", stats: { alpha: 90, beta: 10, tries: 100, wins: 90 } },
      { id: "loser",  stats: { alpha: 10, beta: 90, tries: 100, wins: 10 } },
    ];
    let winnerCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms, { winner: 1.0 }).variantId === "winner") winnerCount++;
    }
    expect(winnerCount).toBeGreaterThan(800);
  });
});
