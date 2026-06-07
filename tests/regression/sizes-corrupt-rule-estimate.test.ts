// Regression: a corrupt/unparseable Segment.rule must not crash sizes-page assembly.
// It should resolve to a null estimate (no DB call, no throw) so the row renders "invalid rule".
// See docs/superpowers/specs/2026-06-07-segments-sizes-c2-design.md (Error handling).
import { describe, expect, it } from "bun:test";
import { safeEstimateForRule } from "@/lib/segments/size-rows";

describe("safeEstimateForRule — corrupt rule", () => {
  it("returns null for a garbage object without throwing", async () => {
    expect(await safeEstimateForRule({ totally: "not a rule" })).toBeNull();
  });

  it("returns null for null", async () => {
    expect(await safeEstimateForRule(null)).toBeNull();
  });

  it("returns null for a condition with an unknown field", async () => {
    const rule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "nope", operator: "eq", value: 1 }] };
    expect(await safeEstimateForRule(rule)).toBeNull();
  });
});
