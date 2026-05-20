import { describe, expect, it } from "bun:test";
import { LinUCB } from "@/lib/engine/linucb";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

// Use a small dimension for most tests to keep arithmetic tractable
const D = 3;
const linucb = new LinUCB(1.0);

function initialArm(id: string) {
  const { aInv, b } = linucb.initialArm(D);
  return { id, aInv, b };
}

describe("LinUCB.initialArm", () => {
  it("aInv is identity matrix of size d×d", () => {
    const { aInv, b } = linucb.initialArm(D);
    expect(aInv).toHaveLength(D * D);
    for (let i = 0; i < D; i++) {
      expect(aInv[i * D + i]).toBeCloseTo(1.0);
    }
    expect(aInv[0 * D + 1]).toBeCloseTo(0);
    expect(aInv[1 * D + 0]).toBeCloseTo(0);
    expect(b).toHaveLength(D);
    expect(b.every((v) => v === 0)).toBe(true);
  });

  it("defaults to FEATURE_DIM when no arg passed", () => {
    const { aInv, b } = linucb.initialArm();
    expect(aInv).toHaveLength(FEATURE_DIM * FEATURE_DIM);
    expect(b).toHaveLength(FEATURE_DIM);
  });
});

describe("LinUCB.select", () => {
  it("throws on empty arm list", () => {
    expect(() => linucb.select([], [1, 0, 0])).toThrow();
  });

  it("returns the only arm when there is one", () => {
    expect(linucb.select([initialArm("a")], [1, 0, 0]).variantId).toBe("a");
  });

  it("selects arm with highest UCB score — positive reward history wins", () => {
    const exploit = new LinUCB(0.01);
    let armA = initialArm("A");
    let armB = initialArm("B");
    const ctx = [1, 0, 0];
    for (let i = 0; i < 5; i++) {
      armA = { id: "A", ...exploit.update(armA.aInv, armA.b, ctx,  1.0) };
      armB = { id: "B", ...exploit.update(armB.aInv, armB.b, ctx, -1.0) };
    }
    expect(exploit.select([armA, armB], ctx).variantId).toBe("A");
  });
});

describe("LinUCB.update", () => {
  it("accumulates reward in b vector", () => {
    const { aInv, b } = linucb.initialArm(D);
    const updated = linucb.update(aInv, b, [1, 0, 0], 1.0);
    expect(updated.b[0]).toBeCloseTo(1.0);
    expect(updated.b[1]).toBeCloseTo(0);
    expect(updated.b[2]).toBeCloseTo(0);
  });

  it("accumulates over multiple updates", () => {
    let { aInv, b } = linucb.initialArm(D);
    ({ aInv, b } = linucb.update(aInv, b, [0, 1, 0], 1.0));
    ({ aInv, b } = linucb.update(aInv, b, [0, 1, 0], 1.0));
    expect(b[1]).toBeGreaterThan(0);
  });

  it("does not mutate original aInv or b", () => {
    const orig = linucb.initialArm(D);
    const origB0 = orig.b[0];
    const origAInv00 = orig.aInv[0];
    linucb.update(orig.aInv, orig.b, [1, 0, 0], 1.0);
    expect(orig.b[0]).toBe(origB0);
    expect(orig.aInv[0]).toBe(origAInv00);
  });

  it("positive reward increases predicted reward on same context", () => {
    const noExplore = new LinUCB(0.0);
    let armA = initialArm("A");
    const armB = initialArm("B");
    const ctx = [1, 0, 0];
    armA = { id: "A", ...noExplore.update(armA.aInv, armA.b, ctx, 1.0) };
    expect(noExplore.select([armA, armB], ctx).variantId).toBe("A");
  });
});
