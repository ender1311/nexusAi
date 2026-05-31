import { describe, it, expect } from "bun:test";
import { resolveSegmentTargeting } from "@/lib/agent-targeting";

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
