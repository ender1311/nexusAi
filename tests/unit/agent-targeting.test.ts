import { describe, it, expect } from "bun:test";
import { resolveSegmentTargeting, parseSegmentTargeting } from "@/lib/agent-targeting";

describe("resolveSegmentTargeting", () => {
  describe("segment mode", () => {
    it("returns includes + excludes when includes are present", () => {
      expect(resolveSegmentTargeting(true, ["a", "b"], ["c"])).toEqual({
        includes: ["a", "b"],
        excludes: ["c"],
      });
    });

    it("keeps an empty excludes array alongside includes", () => {
      expect(resolveSegmentTargeting(true, ["a"], [])).toEqual({
        includes: ["a"],
        excludes: [],
      });
    });

    it("returns null when includes are empty (includes are required in segment mode)", () => {
      expect(resolveSegmentTargeting(true, [], ["c"])).toBeNull();
      expect(resolveSegmentTargeting(true, [], [])).toBeNull();
    });
  });

  describe("funnel-stage mode", () => {
    it("returns standalone excludes with empty includes", () => {
      expect(resolveSegmentTargeting(false, [], ["c", "d"])).toEqual({
        includes: [],
        excludes: ["c", "d"],
      });
    });

    it("ignores includes when not in segment mode", () => {
      expect(resolveSegmentTargeting(false, ["a"], ["c"])).toEqual({
        includes: [],
        excludes: ["c"],
      });
    });

    it("returns null when there are no excludes to carry over", () => {
      expect(resolveSegmentTargeting(false, ["a"], [])).toBeNull();
      expect(resolveSegmentTargeting(false, [], [])).toBeNull();
    });
  });
});

describe("parseSegmentTargeting", () => {
  it("parses a well-formed value", () => {
    expect(parseSegmentTargeting({ includes: ["a", "b"], excludes: ["c"] })).toEqual({
      includes: ["a", "b"],
      excludes: ["c"],
    });
  });

  it("defaults a missing key to an empty array", () => {
    expect(parseSegmentTargeting({ includes: ["a"] })).toEqual({ includes: ["a"], excludes: [] });
    expect(parseSegmentTargeting({ excludes: ["c"] })).toEqual({ includes: [], excludes: ["c"] });
  });

  it("filters out non-string members so they never reach a Prisma `in` query", () => {
    expect(parseSegmentTargeting({ includes: ["a", 1, null, "b"], excludes: [true, "c"] })).toEqual({
      includes: ["a", "b"],
      excludes: ["c"],
    });
  });

  it("returns null for null / non-object / array inputs", () => {
    expect(parseSegmentTargeting(null)).toBeNull();
    expect(parseSegmentTargeting(undefined)).toBeNull();
    expect(parseSegmentTargeting("nope")).toBeNull();
    expect(parseSegmentTargeting(42)).toBeNull();
    expect(parseSegmentTargeting(["a", "b"])).toBeNull();
  });

  it("returns null when both arrays end up empty", () => {
    expect(parseSegmentTargeting({ includes: [], excludes: [] })).toBeNull();
    expect(parseSegmentTargeting({ includes: [1, 2], excludes: [3] })).toBeNull();
    expect(parseSegmentTargeting({})).toBeNull();
  });
});
