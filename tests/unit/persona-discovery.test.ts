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
  it("identifies push as dominant channel when dim 0 is highest", () => {
    const centroid = vec({ 0: 0.8, 1: 0.2, 2: 0.1 });
    expect(deriveTrait(centroid).dominantChannel).toBe("push");
  });

  it("identifies email as dominant channel when dim 1 is highest", () => {
    const centroid = vec({ 0: 0.1, 1: 0.9, 2: 0.1 });
    expect(deriveTrait(centroid).dominantChannel).toBe("email");
  });

  it("identifies sms as dominant channel when dim 2 is highest", () => {
    const centroid = vec({ 0: 0.1, 1: 0.2, 2: 0.8 });
    expect(deriveTrait(centroid).dominantChannel).toBe("sms");
  });

  it("defaults to push when all channel rates are 0", () => {
    const centroid = vec();
    expect(deriveTrait(centroid).dominantChannel).toBe("push");
  });

  it("peakHour is the index of the max hourly rate (dims 3–26)", () => {
    const centroid = vec({ 15: 0.9 }); // hour 15–3=12 → hourlyRates[12]
    // hourlyRates = centroid.slice(3, 27), so index 15 in centroid = index 12 in hourlyRates
    expect(deriveTrait(centroid).peakHour).toBe(12);
  });

  it("returns engagementLevel=daily when freq > 0.7 (dim 35)", () => {
    expect(deriveTrait(vec({ 35: 0.8 })).engagementLevel).toBe("daily");
  });

  it("returns engagementLevel=regular when 0.5 < freq <= 0.7", () => {
    expect(deriveTrait(vec({ 35: 0.6 })).engagementLevel).toBe("regular");
  });

  it("returns engagementLevel=moderate when 0.3 < freq <= 0.5", () => {
    expect(deriveTrait(vec({ 35: 0.4 })).engagementLevel).toBe("moderate");
  });

  it("returns engagementLevel=weekly when 0.15 < freq <= 0.3", () => {
    expect(deriveTrait(vec({ 35: 0.2 })).engagementLevel).toBe("weekly");
  });

  it("returns engagementLevel=sporadic when freq <= 0.15", () => {
    expect(deriveTrait(vec({ 35: 0.1 })).engagementLevel).toBe("sporadic");
    expect(deriveTrait(vec({ 35: 0 })).engagementLevel).toBe("sporadic");
  });

  it("returns giverProfile=sower when dim 37 >= 0.9", () => {
    expect(deriveTrait(vec({ 37: 0.95 })).giverProfile).toBe("sower");
    expect(deriveTrait(vec({ 37: 0.9 })).giverProfile).toBe("sower");
  });

  it("returns giverProfile=giver when 0.4 <= dim 37 < 0.9", () => {
    expect(deriveTrait(vec({ 37: 0.5 })).giverProfile).toBe("giver");
    expect(deriveTrait(vec({ 37: 0.4 })).giverProfile).toBe("giver");
  });

  it("returns giverProfile=non-giver when dim 37 < 0.4", () => {
    expect(deriveTrait(vec({ 37: 0.1 })).giverProfile).toBe("non-giver");
    expect(deriveTrait(vec()).giverProfile).toBe("non-giver");
  });

  it("passes through streakDepth from dim 38 and planDepth from dim 40", () => {
    const centroid = vec({ 38: 0.75, 40: 0.55 });
    const t = deriveTrait(centroid);
    expect(t.streakDepth).toBeCloseTo(0.75);
    expect(t.planDepth).toBeCloseTo(0.55);
  });

  it("conversionRate comes from dim 34", () => {
    const centroid = vec({ 34: 0.42 });
    expect(deriveTrait(centroid).conversionRate).toBeCloseTo(0.42);
  });
});
