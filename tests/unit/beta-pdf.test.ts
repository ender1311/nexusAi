import { describe, expect, it } from "bun:test";
import { betaPDFPoints, recencyMultiplier } from "@/lib/engine/beta-pdf";

describe("betaPDFPoints", () => {
  it("returns 50 points for any valid (alpha, beta)", () => {
    const pts = betaPDFPoints(2, 5);
    expect(pts.length).toBe(50);
    expect(pts[0]).toHaveProperty("x");
    expect(pts[0]).toHaveProperty("y");
  });

  it("all x values are in (0, 1)", () => {
    const pts = betaPDFPoints(3, 8);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
    }
  });

  it("all y values are non-negative", () => {
    const pts = betaPDFPoints(5, 2);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("Beta(1,1) is approximately uniform — max y close to 1", () => {
    const pts = betaPDFPoints(1, 1);
    const maxY = Math.max(...pts.map((p) => p.y));
    // Beta(1,1) PDF = 1 everywhere; with normalization max should be near 1
    expect(maxY).toBeGreaterThan(0.9);
    expect(maxY).toBeLessThan(1.1);
  });

  it("mode of Beta(5,2) is near 0.8 — argmax x", () => {
    const pts = betaPDFPoints(5, 2);
    const modePoint = pts.reduce((a, b) => (a.y > b.y ? a : b));
    expect(modePoint.x).toBeGreaterThan(0.7);
    expect(modePoint.x).toBeLessThan(0.9);
  });
});

describe("recencyMultiplier", () => {
  it("returns 1.0 for undefined (never sent)", () => {
    expect(recencyMultiplier(undefined)).toBe(1.0);
  });

  it("returns exp(-0.3 * days) for a given number of days", () => {
    const result = recencyMultiplier(1);
    expect(result).toBeCloseTo(Math.exp(-0.3), 5);
  });

  it("clamps to 0.2 minimum", () => {
    expect(recencyMultiplier(100)).toBeGreaterThanOrEqual(0.2);
  });

  it("0 days since sent gives 1.0 — same-day sends are not demoted", () => {
    // exp(-0.3 * 0) = exp(0) = 1.0
    expect(recencyMultiplier(0)).toBe(1.0);
  });
});
