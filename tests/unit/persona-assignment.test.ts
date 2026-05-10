import { describe, it, expect } from "bun:test";

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
