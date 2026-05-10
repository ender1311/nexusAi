import { describe, it, expect } from "bun:test";
import { LinUCB } from "@/lib/engine/linucb";

const DIM = 3; // small dimension for tests

function makeArm(id: string, dim = DIM) {
  const linucb = new LinUCB();
  const { aInv, b } = linucb.initialArm(dim);
  return { id, aInv, b };
}

describe("LinUCB", () => {
  // ─── initialArm ──────────────────────────────────────────────────────────────

  it("initialArm returns identity A^{-1} and zero b", () => {
    const linucb = new LinUCB();
    const { aInv, b } = linucb.initialArm(DIM);
    expect(aInv.length).toBe(DIM * DIM);
    expect(b.length).toBe(DIM);
    // A^{-1} should be identity matrix
    for (let i = 0; i < DIM; i++) {
      for (let j = 0; j < DIM; j++) {
        expect(aInv[i * DIM + j]).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
    expect(b.every((v) => v === 0)).toBe(true);
  });

  // ─── select ───────────────────────────────────────────────────────────────────

  it("select throws on empty arm list", () => {
    const linucb = new LinUCB();
    expect(() => linucb.select([], [1, 0, 0])).toThrow();
  });

  it("select returns a valid variantId", () => {
    const linucb = new LinUCB();
    const arms = [makeArm("v1"), makeArm("v2"), makeArm("v3")];
    const context = [0.5, 0.3, 0.2];
    const { variantId } = linucb.select(arms, context);
    expect(["v1", "v2", "v3"]).toContain(variantId);
  });

  it("select with single arm returns that arm", () => {
    const linucb = new LinUCB();
    const arm = makeArm("only");
    const { variantId } = linucb.select([arm], [1, 0, 0]);
    expect(variantId).toBe("only");
  });

  it("uniform cold-start arms — all arms have identical initial scores", () => {
    // With identity A^{-1} and zero b: θ = 0, UCB bonus = α * |x|
    // All arms start the same so score difference is purely stochastic
    const linucb = new LinUCB();
    const arms = [makeArm("a"), makeArm("b")];
    const context = [1, 0, 0];
    // Both arms should give the same score from linucb.score()
    const scoreA = linucb.score(arms[0]!.aInv, arms[0]!.b, context);
    const scoreB = linucb.score(arms[1]!.aInv, arms[1]!.b, context);
    expect(scoreA).toBeCloseTo(scoreB, 10);
  });

  // ─── update (Sherman-Morrison) ────────────────────────────────────────────────

  it("update returns new aInv and b without mutating inputs", () => {
    const linucb = new LinUCB();
    const { aInv, b } = linucb.initialArm(DIM);
    const aInvCopy = [...aInv];
    const bCopy = [...b];
    const context = [1, 0, 0];
    linucb.update(aInv, b, context, 1.0);
    // Original arrays must not be mutated
    expect(aInv).toEqual(aInvCopy);
    expect(b).toEqual(bCopy);
  });

  it("update with reward=1 increases b in the context direction", () => {
    const linucb = new LinUCB();
    const { aInv, b } = linucb.initialArm(DIM);
    const context = [1, 0, 0];
    const { b: newB } = linucb.update(aInv, b, context, 1.0);
    // b += 1.0 * x = [1, 0, 0]
    expect(newB[0]).toBeCloseTo(1.0, 10);
    expect(newB[1]).toBeCloseTo(0.0, 10);
    expect(newB[2]).toBeCloseTo(0.0, 10);
  });

  it("update with reward=0 leaves b unchanged", () => {
    const linucb = new LinUCB();
    const { aInv, b } = linucb.initialArm(DIM);
    const { b: newB } = linucb.update(aInv, b, [1, 1, 1], 0);
    expect(newB.every((v) => v === 0)).toBe(true);
  });

  it("after update, A^{-1} changes (Sherman-Morrison)", () => {
    const linucb = new LinUCB();
    const { aInv, b } = linucb.initialArm(DIM);
    const { aInv: newAInv } = linucb.update(aInv, b, [1, 0, 0], 1.0);
    // A^{-1} should differ from identity after rank-1 update
    expect(newAInv[0]).not.toBeCloseTo(1.0, 10); // (0,0) element changes
    // Non-diagonal element (0,1) was 0, should still be 0 for axis-aligned context
    expect(newAInv[1]).toBeCloseTo(0.0, 10);
  });

  // ─── Learning direction ───────────────────────────────────────────────────────

  it("arm rewarded on context x scores higher on x after update", () => {
    const linucb = new LinUCB(0); // alpha=0 → pure exploitation (no UCB bonus)
    let arm = makeArm("winner");
    const context = [1, 0, 0];
    // Update arm with 5 positive rewards on context
    for (let i = 0; i < 5; i++) {
      const updated = linucb.update(arm.aInv, arm.b, context, 1.0);
      arm = { ...arm, ...updated };
    }
    const loser = makeArm("loser");
    const scoreBefore = linucb.score(loser.aInv, loser.b, context);
    const scoreAfter = linucb.score(arm.aInv, arm.b, context);
    expect(scoreAfter).toBeGreaterThan(scoreBefore);
  });

  it("select chooses the trained arm when alpha=0", () => {
    const linucb = new LinUCB(0); // pure exploitation
    let winner = makeArm("winner");
    const loser = makeArm("loser");
    const context = [0.8, 0.1, 0.1];
    // Train winner arm
    for (let i = 0; i < 10; i++) {
      const updated = linucb.update(winner.aInv, winner.b, context, 1.0);
      winner = { ...winner, ...updated };
    }
    const { variantId } = linucb.select([winner, loser], context);
    expect(variantId).toBe("winner");
  });

  // ─── score ────────────────────────────────────────────────────────────────────

  it("score with zero context vector is 0 (no exploitation, no uncertainty)", () => {
    const linucb = new LinUCB(1.0);
    const { aInv, b } = linucb.initialArm(DIM);
    const score = linucb.score(aInv, b, [0, 0, 0]);
    expect(score).toBeCloseTo(0, 10);
  });
});
