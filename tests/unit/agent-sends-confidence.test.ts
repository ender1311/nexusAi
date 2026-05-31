import { describe, it, expect } from "bun:test";
import { classifyConfidence, summarizeVariantScores } from "@/lib/agent-sends/confidence";

describe("classifyConfidence", () => {
  it("is high at 70% or above", () => {
    expect(classifyConfidence(70)).toBe("high");
    expect(classifyConfidence(100)).toBe("high");
  });

  it("is moderate between 40% and 70%", () => {
    expect(classifyConfidence(40)).toBe("moderate");
    expect(classifyConfidence(69)).toBe("moderate");
  });

  it("is exploratory below 40%", () => {
    expect(classifyConfidence(39)).toBe("exploratory");
    expect(classifyConfidence(0)).toBe("exploratory");
  });
});

describe("summarizeVariantScores", () => {
  it("sorts scores high → low and computes the winner share", () => {
    const s = summarizeVariantScores({ a: 1, b: 3, c: 6 });
    expect(s.sorted.map(([id]) => id)).toEqual(["c", "b", "a"]);
    expect(s.totalScore).toBe(10);
    expect(s.winnerScore).toBe(6);
    expect(s.maxScore).toBe(6);
    expect(s.winnerSharePct).toBe(60);
  });

  it("rounds the winner share to the nearest percent", () => {
    const s = summarizeVariantScores({ a: 1, b: 2 });
    expect(s.winnerSharePct).toBe(67); // 2/3 = 66.6…
  });

  it("returns zero share for an empty score map", () => {
    const s = summarizeVariantScores({});
    expect(s.totalScore).toBe(0);
    expect(s.winnerSharePct).toBe(0);
    expect(s.maxScore).toBe(1);
  });
});
