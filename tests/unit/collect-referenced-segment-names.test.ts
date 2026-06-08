import { describe, it, expect } from "bun:test";
import { collectReferencedSegmentNames } from "@/lib/segments/materialize";

describe("collectReferencedSegmentNames", () => {
  it("collects includes, excludes, and legacy targetSegmentName, deduped", () => {
    const names = collectReferencedSegmentNames([
      { segmentTargeting: { includes: ["a", "b"], excludes: ["c"] }, targetSegmentName: null },
      { segmentTargeting: { includes: ["b"], excludes: [] }, targetSegmentName: "d" },
      { segmentTargeting: null, targetSegmentName: "a" },
    ]);
    expect([...names].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty set when no agent targets a segment", () => {
    const names = collectReferencedSegmentNames([
      { segmentTargeting: null, targetSegmentName: null },
    ]);
    expect(names.size).toBe(0);
  });

  it("tolerates corrupt segmentTargeting JSON (degrades to skip)", () => {
    const names = collectReferencedSegmentNames([
      { segmentTargeting: "not-an-object", targetSegmentName: null },
      { segmentTargeting: { includes: "oops", excludes: 42 }, targetSegmentName: "real" },
    ]);
    expect([...names]).toEqual(["real"]);
  });
});
