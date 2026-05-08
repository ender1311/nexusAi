import { describe, expect, it } from "bun:test";
import { LinUCB } from "@/lib/engine/lin-ucb";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { LinUCBArm } from "@/lib/engine/types";

// Use a small feature dimension for most tests to keep arithmetic tractable.
const D = 3;

function makeArm(id: string, ucb: LinUCB): LinUCBArm {
  return { id, linucbStats: ucb.initialStats() };
}

describe("LinUCB", () => {
  // ─── initialStats ─────────────────────────────────────────────────────────
  describe("initialStats", () => {
    it("aInv is (1/lambda)*I for d=3, lambda=1", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const { aInv, b, tries } = ucb.initialStats();

      expect(aInv).toHaveLength(D * D);
      // Diagonal = 1.0
      for (let i = 0; i < D; i++) {
        expect(aInv[i * D + i]).toBeCloseTo(1.0);
      }
      // Off-diagonal = 0
      expect(aInv[0 * D + 1]).toBeCloseTo(0);
      expect(aInv[1 * D + 0]).toBeCloseTo(0);

      expect(b).toHaveLength(D);
      expect(b.every((v) => v === 0)).toBe(true);
      expect(tries).toBe(0);
    });

    it("scales diagonal by 1/lambda when lambda=2", () => {
      const ucb = new LinUCB(1.0, 2.0, D);
      const { aInv } = ucb.initialStats();
      for (let i = 0; i < D; i++) {
        expect(aInv[i * D + i]).toBeCloseTo(0.5);
      }
    });

    it("uses FEATURE_DIM when no d argument is passed", () => {
      const ucb = new LinUCB();
      const { aInv, b } = ucb.initialStats();
      expect(aInv).toHaveLength(FEATURE_DIM * FEATURE_DIM);
      expect(b).toHaveLength(FEATURE_DIM);
    });
  });

  // ─── select ───────────────────────────────────────────────────────────────
  describe("select", () => {
    it("throws on empty arm list", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      expect(() => ucb.select([], [1, 0, 0])).toThrow();
    });

    it("returns the only arm when there is one", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const arm = makeArm("a", ucb);
      const result = ucb.select([arm], [1, 0, 0]);
      expect(result.variantId).toBe("a");
    });

    it("selects arm with highest UCB score — arm with positive reward history wins", () => {
      const ucb = new LinUCB(0.01, 1.0, D); // low alpha → exploitation dominates

      const armA = makeArm("A", ucb);
      const armB = makeArm("B", ucb);

      // Give arm A lots of positive reward, arm B negative
      let statsA = armA.linucbStats;
      let statsB = armB.linucbStats;
      const ctx = [1, 0, 0];
      for (let i = 0; i < 5; i++) {
        statsA = ucb.update(statsA, ctx, 1.0);
        statsB = ucb.update(statsB, ctx, -1.0);
      }

      const result = ucb.select(
        [{ id: "A", linucbStats: statsA }, { id: "B", linucbStats: statsB }],
        ctx,
      );
      expect(result.variantId).toBe("A");
    });

    it("marks arm with fewer tries as explore=true", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const ctx = [1, 0, 0];

      let statsA = ucb.initialStats();
      // Give arm A more tries
      statsA = ucb.update(statsA, ctx, 0.5);
      statsA = ucb.update(statsA, ctx, 0.5);
      const statsB = ucb.initialStats(); // 0 tries

      const arms = [
        { id: "A", linucbStats: statsA },
        { id: "B", linucbStats: statsB },
      ];

      const result = ucb.select(arms, ctx);
      // The selected arm has fewer tries than max → explore
      if (result.variantId === "B") {
        expect(result.explore).toBe(true);
      }
    });

    it("explore is false when all arms have equal tries", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const ctx = [1, 0, 0];

      const statsA = ucb.update(ucb.initialStats(), ctx, 0.5);
      const statsB = ucb.update(ucb.initialStats(), ctx, 0.5);

      const result = ucb.select(
        [{ id: "A", linucbStats: statsA }, { id: "B", linucbStats: statsB }],
        ctx,
      );
      expect(result.explore).toBe(false);
    });

    it("pads short context vector to feature dimension", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const arm = makeArm("a", ucb);
      // Pass only 1 element — should be padded to [1, 0, 0]
      expect(() => ucb.select([arm], [1])).not.toThrow();
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────
  describe("update", () => {
    it("increments tries by 1", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const stats = ucb.initialStats();
      const updated = ucb.update(stats, [1, 0, 0], 1.0);
      expect(updated.tries).toBe(1);
    });

    it("accumulates reward in b vector", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const stats = ucb.initialStats();
      // After update with context [1,0,0] and reward 1: b should be [1,0,0]
      const updated = ucb.update(stats, [1, 0, 0], 1.0);
      expect(updated.b[0]).toBeCloseTo(1.0);
      expect(updated.b[1]).toBeCloseTo(0);
      expect(updated.b[2]).toBeCloseTo(0);
    });

    it("b update is linear — two updates with same context/reward accumulate", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      let stats = ucb.initialStats();
      stats = ucb.update(stats, [0, 1, 0], 1.0);
      stats = ucb.update(stats, [0, 1, 0], 1.0);
      // b should be ~[0, 2, 0] (Sherman-Morrison shrinks A_inv, but b just accumulates r*x)
      expect(stats.b[1]).toBeGreaterThan(0);
      expect(stats.tries).toBe(2);
    });

    it("does not mutate original stats object", () => {
      const ucb = new LinUCB(1.0, 1.0, D);
      const original = ucb.initialStats();
      const origB0 = original.b[0];
      ucb.update(original, [1, 0, 0], 1.0);
      expect(original.b[0]).toBe(origB0); // unchanged
    });

    it("positive reward increases predicted reward on same context", () => {
      const ucb = new LinUCB(0.0, 1.0, D); // alpha=0 → no exploration bonus
      const armA = makeArm("A", ucb);
      const armB = makeArm("B", ucb);
      const ctx = [1, 0, 0];

      const updatedA = { id: "A", linucbStats: ucb.update(armA.linucbStats, ctx, 1.0) };
      const result = ucb.select([updatedA, { id: "B", linucbStats: armB.linucbStats }], ctx);
      expect(result.variantId).toBe("A");
    });
  });
});
