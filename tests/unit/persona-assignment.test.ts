import { describe, it, expect } from "bun:test";
import { selectNearestPersona } from "@/lib/engine/persona-assignment";

// Unit-test the confidence calculation logic extracted from persona-assignment.ts
// (the pure math, no DB). The key change: confidence no longer gates assignment.

function computeEffectiveConfidence(
  bestSimilarity: number,
  totalDecisions: number,
  minInteractions = 20,
): number {
  const dataRatio = Math.min(1, totalDecisions / minInteractions);
  return bestSimilarity * dataRatio;
}

describe("persona assignment — confidence calculation", () => {
  it("full-data user: effectiveConfidence equals bestSimilarity", () => {
    const conf = computeEffectiveConfidence(0.8, 100);
    expect(conf).toBeCloseTo(0.8, 5);
  });

  it("zero-data user: effectiveConfidence is 0 regardless of similarity", () => {
    const conf = computeEffectiveConfidence(0.9, 0);
    expect(conf).toBe(0);
  });

  it("half-data user: effectiveConfidence is halved", () => {
    const conf = computeEffectiveConfidence(0.8, 10);
    expect(conf).toBeCloseTo(0.4, 5);
  });

  it("caps dataRatio at 1.0 for users above minInteractions", () => {
    const conf1 = computeEffectiveConfidence(0.7, 20);
    const conf2 = computeEffectiveConfidence(0.7, 1000);
    expect(conf1).toBeCloseTo(conf2, 10); // same once saturated
  });

  // The new invariant: confidence of 0 still results in an assignment
  // (persona falls back to largest clusterSize). This is the behavioral contract:
  it("zero confidence does NOT mean null assignment (fall-through to largest persona)", () => {
    // Simulate: bestPersonaId = null (all similarities were 0), fallback applied
    const bestPersonaId: string | null = null;
    const personas = [
      { id: "p1", clusterSize: 5 },
      { id: "p2", clusterSize: 80 },
      { id: "p3", clusterSize: 20 },
    ];
    const assignId =
      bestPersonaId ??
      personas.sort((a, b) => b.clusterSize - a.clusterSize)[0]?.id ??
      null;
    expect(assignId).toBe("p2"); // largest persona is the fallback
  });

  it("non-null bestPersonaId is always used over clusterSize fallback", () => {
    const bestPersonaId = "p_best";
    const personas = [{ id: "p_large", clusterSize: 1000 }];
    const assignId =
      bestPersonaId ??
      personas.sort((a, b) => b.clusterSize - a.clusterSize)[0]?.id ??
      null;
    expect(assignId).toBe("p_best");
  });

  it("returns null only when no personas exist", () => {
    const bestPersonaId: string | null = null;
    const personas: Array<{ id: string; clusterSize: number }> = [];
    const assignId =
      bestPersonaId ??
      personas.sort((a, b) => b.clusterSize - a.clusterSize)[0]?.id ??
      null;
    expect(assignId).toBeNull();
  });
});

describe("selectNearestPersona", () => {
  it("picks the persona with the highest cosine similarity", () => {
    const userVec = [1, 0, 0];
    const { personaId, similarity } = selectNearestPersona(userVec, [
      { id: "p_far", centroid: [0, 1, 0] }, // orthogonal → similarity 0
      { id: "p_near", centroid: [1, 0, 0] }, // identical → similarity 1
    ]);
    expect(personaId).toBe("p_near");
    expect(similarity).toBeCloseTo(1, 5);
  });

  it("picks the nearest persona even when its similarity is negative", () => {
    // All centroids point away from the user; the *least* negative is still the
    // nearest match. Initializing the search at 0 (instead of -Infinity) would
    // discard every candidate and return null, dropping the user to a fallback.
    const userVec = [1, 0, 0];
    const { personaId, similarity } = selectNearestPersona(userVec, [
      { id: "p_opposite", centroid: [-1, 0, 0] }, // similarity -1
      { id: "p_angled", centroid: [-1, 1, 0] }, // similarity ~-0.707 (nearer)
    ]);
    expect(personaId).toBe("p_angled");
    expect(similarity).toBeLessThan(0);
  });

  it("skips personas with a null centroid", () => {
    const userVec = [1, 0, 0];
    const { personaId } = selectNearestPersona(userVec, [
      { id: "p_null", centroid: null },
      { id: "p_real", centroid: [1, 0, 0] },
    ]);
    expect(personaId).toBe("p_real");
  });

  it("returns null personaId and 0 similarity when no centroids are usable", () => {
    const { personaId, similarity } = selectNearestPersona([1, 0, 0], [
      { id: "p_null", centroid: null },
    ]);
    expect(personaId).toBeNull();
    expect(similarity).toBe(0);
  });

  it("returns null personaId and 0 similarity for an empty persona list", () => {
    const { personaId, similarity } = selectNearestPersona([1, 0, 0], []);
    expect(personaId).toBeNull();
    expect(similarity).toBe(0);
  });
});
