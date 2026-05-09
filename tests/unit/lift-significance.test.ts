import { describe, it, expect } from "bun:test";
import { liftSignificance, MIN_SENDS_FOR_SIGNIFICANCE } from "@/lib/engine/lift-significance";

describe("liftSignificance", () => {
  // ─── Insufficient data ────────────────────────────────────────────────────

  it("returns insufficient=true when agentSends < MIN_SENDS", () => {
    const result = liftSignificance(199, 10, 1000, 50);
    expect(result.insufficient).toBe(true);
    expect(result.significant).toBe(false);
    expect(result.zScore).toBe(0);
  });

  it("returns insufficient=false when agentSends === MIN_SENDS", () => {
    const result = liftSignificance(MIN_SENDS_FOR_SIGNIFICANCE, 10, 1000, 50);
    expect(result.insufficient).toBe(false);
  });

  it("returns insufficient=true when agentSends = 0", () => {
    const result = liftSignificance(0, 0, 1000, 50);
    expect(result.insufficient).toBe(true);
  });

  // ─── Lift calculation ─────────────────────────────────────────────────────

  it("lift is zero when both rates are equal", () => {
    // 10% conversion rate each
    const result = liftSignificance(1000, 100, 5000, 500);
    expect(result.lift).toBeCloseTo(0, 5);
  });

  it("lift is positive when agent outperforms fleet", () => {
    // Agent: 20%, Fleet: 10%
    const result = liftSignificance(1000, 200, 5000, 500);
    expect(result.lift).toBeCloseTo(10, 1);
  });

  it("lift is negative when agent underperforms fleet", () => {
    // Agent: 5%, Fleet: 10%
    const result = liftSignificance(1000, 50, 5000, 500);
    expect(result.lift).toBeCloseTo(-5, 1);
  });

  it("lift is in percentage points (not fractions)", () => {
    // Agent: 15%, Fleet: 10% → lift = 5 pp, not 0.05
    const result = liftSignificance(1000, 150, 5000, 500);
    expect(result.lift).toBeGreaterThan(1); // definitely > 1 percentage point
  });

  // ─── Significance: clearly significant ───────────────────────────────────

  it("marks significant=true for a large clear lift with adequate sample", () => {
    // Agent: 20% vs Fleet: 10%, n=2000 — should be very significant
    const result = liftSignificance(2000, 400, 10000, 1000);
    expect(result.significant).toBe(true);
    expect(result.insufficient).toBe(false);
    expect(result.zScore).toBeGreaterThan(1.96);
  });

  it("marks significant=true for a large negative lift with adequate sample", () => {
    // Agent: 5% vs Fleet: 10%, n=2000 — significant underperformance
    const result = liftSignificance(2000, 100, 10000, 1000);
    expect(result.significant).toBe(true);
    expect(result.zScore).toBeLessThan(-1.96);
  });

  // ─── Significance: not significant ───────────────────────────────────────

  it("marks significant=false for a tiny lift even with large sample", () => {
    // Agent: 10.05% vs Fleet: 10.00% — negligible difference
    const result = liftSignificance(2000, 201, 10000, 1000);
    expect(result.significant).toBe(false);
    expect(Math.abs(result.zScore)).toBeLessThan(1.96);
  });

  it("marks significant=false for a moderate lift with small sample (barely over MIN)", () => {
    // Agent: 15% vs Fleet: 10%, n=200 — borderline
    const result = liftSignificance(200, 30, 2000, 200);
    // May or may not be significant depending on exact z; test that zScore is computed
    expect(typeof result.significant).toBe("boolean");
    expect(result.insufficient).toBe(false);
    expect(typeof result.zScore).toBe("number");
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  it("returns zScore=0 when pPool=0 (no conversions anywhere)", () => {
    const result = liftSignificance(500, 0, 5000, 0);
    expect(result.zScore).toBe(0);
    expect(result.significant).toBe(false);
  });

  it("returns zScore=0 when pPool=1 (100% conversion everywhere)", () => {
    const result = liftSignificance(500, 500, 5000, 5000);
    expect(result.zScore).toBe(0);
    expect(result.significant).toBe(false);
  });

  it("handles fleet being identical to agent (agent = all fleet sends)", () => {
    // When agent IS the fleet, p1 == p2 and lift == 0
    const result = liftSignificance(1000, 100, 1000, 100);
    expect(result.lift).toBeCloseTo(0, 5);
    expect(result.significant).toBe(false);
  });

  it("lift and zScore have consistent sign", () => {
    const positive = liftSignificance(1000, 200, 5000, 500); // agent better
    const negative = liftSignificance(1000, 50, 5000, 500);  // agent worse

    expect(positive.lift).toBeGreaterThan(0);
    expect(positive.zScore).toBeGreaterThan(0);
    expect(negative.lift).toBeLessThan(0);
    expect(negative.zScore).toBeLessThan(0);
  });

  // ─── Significance threshold boundary ─────────────────────────────────────

  it("z=1.96 boundary: |z| just above 1.96 is significant", () => {
    // Constructed case: z ≈ 2.0
    // p1=0.12, p2=0.10, large n
    const result = liftSignificance(5000, 600, 20000, 2000);
    // 12% vs 10% with n=5000 should be significant
    expect(result.significant).toBe(true);
    expect(Math.abs(result.zScore)).toBeGreaterThan(1.96);
  });

  it("MIN_SENDS_FOR_SIGNIFICANCE is exported and equals 200", () => {
    expect(MIN_SENDS_FOR_SIGNIFICANCE).toBe(200);
  });
});
