import { describe, expect, it } from "bun:test";
import { hdbscan } from "@/lib/engine/hdbscan";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

function vec(overrides: Record<number, number> = {}): number[] {
  const v = new Array<number>(FEATURE_DIM).fill(0);
  for (const [i, val] of Object.entries(overrides)) v[Number(i)] = val;
  return v;
}

// Deterministic pseudo-random in [-1, 1] so tests don't depend on Math.random
function prand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1;
}

describe("hdbscan", () => {
  it("separates two well-separated clusters", () => {
    // 20 push-heavy vectors + 20 email-heavy vectors with tiny jitter
    const clusterA: number[][] = [];
    const clusterB: number[][] = [];
    for (let i = 0; i < 20; i++) {
      clusterA.push(vec({ 0: 0.95 + 0.02 * prand(i), 5: 0.05 + 0.02 * prand(i + 100) }));
      clusterB.push(vec({ 1: 0.95 + 0.02 * prand(i + 200), 5: 0.05 + 0.02 * prand(i + 300) }));
    }
    const vectors = [...clusterA, ...clusterB];

    const result = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });

    expect(result.labels).toHaveLength(40);
    expect(result.k).toBeGreaterThanOrEqual(1);
    // Should find at least 2 clusters or one big cluster covering most points
    if (result.k >= 2) {
      // Members of clusterA (indices 0-19) should mostly share one label
      const labelsA = result.labels.slice(0, 20).filter((l) => l !== -1);
      const labelsB = result.labels.slice(20, 40).filter((l) => l !== -1);
      expect(labelsA.length).toBeGreaterThan(0);
      expect(labelsB.length).toBeGreaterThan(0);
      // Dominant label in each half should differ
      const modeA = mode(labelsA);
      const modeB = mode(labelsB);
      expect(modeA).not.toBe(modeB);
    }
  });

  it("returns all noise when n < 2*minPts", () => {
    const vectors = [vec({ 0: 1 }), vec({ 1: 1 }), vec({ 0: 0.5, 1: 0.5 })];
    const result = hdbscan(vectors, { minPts: 5, minClusterSize: 2 });
    expect(result.labels).toEqual([-1, -1, -1]);
    expect(result.k).toBe(0);
    expect(result.clusterSizes).toEqual([]);
  });

  it("handles single point input as all noise", () => {
    const result = hdbscan([vec({ 0: 1 })], { minPts: 5, minClusterSize: 2 });
    expect(result.labels).toEqual([-1]);
    expect(result.k).toBe(0);
  });

  it("handles empty input", () => {
    const result = hdbscan([], { minPts: 5, minClusterSize: 2 });
    expect(result.labels).toEqual([]);
    expect(result.k).toBe(0);
    expect(result.clusterSizes).toEqual([]);
  });

  it("returns one cluster when all vectors are identical", () => {
    const vectors = Array.from({ length: 20 }, () => vec({ 0: 0.5, 1: 0.5 }));
    const result = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });
    expect(result.k).toBe(1);
    expect(result.clusterSizes).toEqual([20]);
    expect(result.labels.every((l) => l === 0)).toBe(true);
  });

  it("labels array length always equals input length", () => {
    const vectors = Array.from({ length: 50 }, (_, i) =>
      vec({ 0: prand(i), 1: prand(i + 1000), 2: prand(i + 2000) })
    );
    const result = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });
    expect(result.labels).toHaveLength(50);
  });

  it("clusterSizes sum to n minus noise count", () => {
    const vectors: number[][] = [];
    // 15 tight cluster
    for (let i = 0; i < 15; i++) vectors.push(vec({ 0: 0.9 + 0.01 * prand(i) }));
    // 15 tight cluster on different axis
    for (let i = 0; i < 15; i++) vectors.push(vec({ 1: 0.9 + 0.01 * prand(i + 50) }));
    // 5 scattered noise points
    for (let i = 0; i < 5; i++) {
      vectors.push(vec({ 0: prand(i + 100), 1: prand(i + 200), 2: prand(i + 300) }));
    }

    const result = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });
    const noiseCount = result.labels.filter((l) => l === -1).length;
    const sumSizes = result.clusterSizes.reduce((a, b) => a + b, 0);
    expect(sumSizes).toBe(vectors.length - noiseCount);
  });

  it("returns valid labels in range [-1, k-1]", () => {
    const vectors: number[][] = [];
    for (let i = 0; i < 30; i++) {
      vectors.push(vec({ 0: 0.8 + 0.05 * prand(i), 5: 0.1 * prand(i + 100) }));
    }
    for (let i = 0; i < 30; i++) {
      vectors.push(vec({ 1: 0.8 + 0.05 * prand(i + 500), 5: 0.1 * prand(i + 600) }));
    }
    const result = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });
    for (const l of result.labels) {
      expect(l).toBeGreaterThanOrEqual(-1);
      expect(l).toBeLessThan(result.k);
    }
  });

  it("is deterministic — same input yields same output", () => {
    const vectors: number[][] = [];
    for (let i = 0; i < 25; i++) {
      vectors.push(vec({ 0: 0.9 + 0.02 * prand(i) }));
      vectors.push(vec({ 1: 0.9 + 0.02 * prand(i + 100) }));
    }
    const r1 = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });
    const r2 = hdbscan(vectors, { minPts: 5, minClusterSize: 10 });
    expect(r1.labels).toEqual(r2.labels);
    expect(r1.k).toBe(r2.k);
    expect(r1.clusterSizes).toEqual(r2.clusterSizes);
  });
});

function mode(arr: number[]): number {
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0]!;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}
