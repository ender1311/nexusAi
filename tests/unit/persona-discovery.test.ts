import { describe, expect, it } from "bun:test";
import { kMeansOnce, computeSilhouette, runKMeans, deriveTrait } from "@/lib/engine/persona-discovery";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

// Build a zero-filled vector with specific indices set
function vec(overrides: Record<number, number> = {}): number[] {
  const v = new Array<number>(FEATURE_DIM).fill(0);
  for (const [i, val] of Object.entries(overrides)) v[Number(i)] = val;
  return v;
}

// Two well-separated clusters: A is push-heavy (dim 0), B is email-heavy (dim 1)
const clusterA = Array.from({ length: 5 }, () => vec({ 0: 0.9 + Math.random() * 0.05 }));
const clusterB = Array.from({ length: 5 }, () => vec({ 1: 0.9 + Math.random() * 0.05 }));
const twoClusterVecs = [...clusterA, ...clusterB]; // indices 0–4 = A, 5–9 = B

describe("kMeansOnce", () => {
  it("returns k centroids and n assignments", () => {
    const { centroids, assignments } = kMeansOnce(twoClusterVecs, 2);
    expect(centroids).toHaveLength(2);
    expect(assignments).toHaveLength(twoClusterVecs.length);
  });

  it("separates well-separated clusters correctly (both label sets non-empty)", () => {
    const { assignments } = kMeansOnce(twoClusterVecs, 2);
    const group0 = assignments.filter((a) => a === 0).length;
    const group1 = assignments.filter((a) => a === 1).length;
    expect(group0).toBeGreaterThan(0);
    expect(group1).toBeGreaterThan(0);
    // All 10 vectors are assigned
    expect(group0 + group1).toBe(10);
  });

  it("handles k >= vectors.length by assigning indices cyclically", () => {
    const smallVecs = [vec({ 0: 1 }), vec({ 1: 1 })];
    const { centroids, assignments } = kMeansOnce(smallVecs, 5);
    expect(centroids).toHaveLength(5);
    expect(assignments).toHaveLength(2);
    // Each vector gets its own cluster (index mod k)
    expect(assignments[0]).toBe(0);
    expect(assignments[1]).toBe(1);
  });

  it("handles k = 1 by assigning all vectors to cluster 0", () => {
    const { assignments } = kMeansOnce(twoClusterVecs, 1);
    expect(assignments.every((a) => a === 0)).toBe(true);
  });

  it("converges on identical vectors without infinite loop", () => {
    const identical = Array.from({ length: 6 }, () => vec({ 0: 0.5, 1: 0.5 }));
    const { centroids, assignments } = kMeansOnce(identical, 2);
    expect(centroids).toHaveLength(2);
    expect(assignments).toHaveLength(6);
  });

  it("centroids have FEATURE_DIM elements", () => {
    const { centroids } = kMeansOnce(twoClusterVecs, 2);
    for (const c of centroids) expect(c).toHaveLength(FEATURE_DIM);
  });
});

describe("computeSilhouette", () => {
  it("returns 0 when vectors.length < 2 * k (not enough data)", () => {
    // 3 vectors, k=2 → need at least 4; returns 0
    const threeVecs = twoClusterVecs.slice(0, 3);
    const score = computeSilhouette(threeVecs, [0, 0, 1], 2);
    expect(score).toBe(0);
  });

  it("returns 0 for single-point clusters (no within-cluster distance)", () => {
    // assignments where every point is its own cluster
    const vecs = [vec({ 0: 1 }), vec({ 1: 1 })];
    const score = computeSilhouette(vecs, [0, 1], 2);
    // vectors.length (2) < 2 * k (4) → returns 0 by early-exit guard
    expect(score).toBe(0);
  });

  it("returns a positive score for well-separated clusters", () => {
    const { assignments } = kMeansOnce(twoClusterVecs, 2);
    const score = computeSilhouette(twoClusterVecs, assignments, 2);
    expect(score).toBeGreaterThan(0);
  });

  it("returns a value in [-1, 1]", () => {
    const { assignments } = kMeansOnce(twoClusterVecs, 2);
    const score = computeSilhouette(twoClusterVecs, assignments, 2);
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores well-separated clusters higher than random assignments", () => {
    const { assignments: goodAssignments } = kMeansOnce(twoClusterVecs, 2);
    const goodScore = computeSilhouette(twoClusterVecs, goodAssignments, 2);

    // Random assignments (all in cluster 0)
    const badAssignments = twoClusterVecs.map(() => 0);
    // This hits the early-return path for empty other-clusters
    const badScore = computeSilhouette(twoClusterVecs, badAssignments, 2);

    expect(goodScore).toBeGreaterThan(badScore);
  });

  describe("computeSilhouette — k=1 behavior", () => {
    it("returns a negative value for k=1 (no other cluster to compare against)", () => {
      // This demonstrates WHY the k=1 silhouette gate must be bypassed in discoverPersonas
      const vecs = Array.from({ length: 10 }, () => vec({ 0: 0.9 }));
      const assignments = new Array<number>(10).fill(0);
      const score = computeSilhouette(vecs, assignments, 1);
      // With k=1, minOtherAvg = Infinity → b=0, silhouette = (0-a)/a = -1 (or 0 for identical vectors)
      expect(score).toBeLessThanOrEqual(0);
    });
  });
});

describe("runKMeans", () => {
  it("returns a ClusterResult with the requested k", () => {
    const result = runKMeans(twoClusterVecs, 2, 3);
    expect(result.k).toBe(2);
    expect(result.centroids).toHaveLength(2);
    expect(result.assignments).toHaveLength(twoClusterVecs.length);
    expect(typeof result.silhouetteScore).toBe("number");
  });

  it("silhouette score is non-negative for well-separated clusters", () => {
    const result = runKMeans(twoClusterVecs, 2, 3);
    expect(result.silhouetteScore).toBeGreaterThanOrEqual(0);
  });

  it("runs multiple times and picks best (score is stable across calls)", () => {
    const r1 = runKMeans(twoClusterVecs, 2, 5);
    const r2 = runKMeans(twoClusterVecs, 2, 5);
    // Both runs should find good solutions — scores within 0.2 of each other
    expect(Math.abs(r1.silhouetteScore - r2.silhouetteScore)).toBeLessThan(0.2);
  });
});

describe("deriveTrait", () => {
  // 10-dim layout: [0]=push, [1]=email, [2]=morning, [3]=evening, [4]=weekend,
  //                [5]=conv_rate, [6]=recency, [7]=giving, [8]=spiritual, [9]=freq

  it("identifies push as dominant channel when dim 0 > dim 1", () => {
    const centroid = vec({ 0: 0.8, 1: 0.2 });
    expect(deriveTrait(centroid).dominantChannel).toBe("push");
  });

  it("identifies email as dominant channel when dim 1 > dim 0", () => {
    const centroid = vec({ 0: 0.1, 1: 0.9 });
    expect(deriveTrait(centroid).dominantChannel).toBe("email");
  });

  it("defaults to push when all channel rates are 0", () => {
    expect(deriveTrait(vec()).dominantChannel).toBe("push");
  });

  it("peakHour=9 when morning ratio (dim 2) dominates evening (dim 3)", () => {
    expect(deriveTrait(vec({ 2: 0.6, 3: 0.1 })).peakHour).toBe(9);
  });

  it("peakHour=20 when evening ratio (dim 3) dominates morning (dim 2)", () => {
    expect(deriveTrait(vec({ 2: 0.1, 3: 0.6 })).peakHour).toBe(20);
  });

  it("peakHour=14 (midday) when morning and evening are similar", () => {
    expect(deriveTrait(vec({ 2: 0.3, 3: 0.3 })).peakHour).toBe(14);
    expect(deriveTrait(vec()).peakHour).toBe(14);
  });

  it("returns engagementLevel=daily when freq > 0.7 (dim 9)", () => {
    expect(deriveTrait(vec({ 9: 0.8 })).engagementLevel).toBe("daily");
  });

  it("returns engagementLevel=regular when 0.5 < freq <= 0.7", () => {
    expect(deriveTrait(vec({ 9: 0.6 })).engagementLevel).toBe("regular");
  });

  it("returns engagementLevel=moderate when 0.3 < freq <= 0.5", () => {
    expect(deriveTrait(vec({ 9: 0.4 })).engagementLevel).toBe("moderate");
  });

  it("returns engagementLevel=weekly when 0.15 < freq <= 0.3", () => {
    expect(deriveTrait(vec({ 9: 0.2 })).engagementLevel).toBe("weekly");
  });

  it("returns engagementLevel=sporadic when freq <= 0.15", () => {
    expect(deriveTrait(vec({ 9: 0.1 })).engagementLevel).toBe("sporadic");
    expect(deriveTrait(vec({ 9: 0 })).engagementLevel).toBe("sporadic");
  });

  it("returns giverProfile=sower when dim 7 >= 0.9", () => {
    expect(deriveTrait(vec({ 7: 0.95 })).giverProfile).toBe("sower");
    expect(deriveTrait(vec({ 7: 0.9 })).giverProfile).toBe("sower");
  });

  it("returns giverProfile=giver when 0.4 <= dim 7 < 0.9", () => {
    expect(deriveTrait(vec({ 7: 0.5 })).giverProfile).toBe("giver");
    expect(deriveTrait(vec({ 7: 0.4 })).giverProfile).toBe("giver");
  });

  it("returns giverProfile=non-giver when dim 7 < 0.4", () => {
    expect(deriveTrait(vec({ 7: 0.1 })).giverProfile).toBe("non-giver");
    expect(deriveTrait(vec()).giverProfile).toBe("non-giver");
  });

  it("streakDepth and planDepth reflect spiritual composite (dim 8)", () => {
    const centroid = vec({ 8: 0.65 });
    const t = deriveTrait(centroid);
    expect(t.streakDepth).toBeCloseTo(0.65);
    expect(t.planDepth).toBeCloseTo(0.65);
  });

  it("conversionRate comes from dim 5", () => {
    expect(deriveTrait(vec({ 5: 0.42 })).conversionRate).toBeCloseTo(0.42);
  });
});
