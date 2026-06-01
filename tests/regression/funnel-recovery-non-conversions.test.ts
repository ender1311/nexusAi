// Regression: spec B1 matrix. A lapsed user must only count as recovered when the
// reached active stage is AT LEAST as engaged as their pre-lapse tier. These three
// "downgrade" climbs and any →new must NEVER be conversions. Linked rule:
// docs/superpowers/specs/2026-05-31-exclusive-assignment-and-funnel-recovery-design.md (B1).
import { describe, expect, it } from "bun:test";
import { isRecovery } from "@/lib/engine/funnel-recovery";

describe("funnel-recovery non-conversions (regression)", () => {
  it("does not treat a climb to a lower tier than the lapse counterpart as recovery", () => {
    expect(isRecovery("lapsed_dau4", "mau")).toBe(false);
    expect(isRecovery("lapsed_dau4", "wau")).toBe(false);
    expect(isRecovery("lapsed_wau", "mau")).toBe(false);
  });
  it("never treats reaching `new` as a recovery", () => {
    expect(isRecovery("lapsed_mau", "new")).toBe(false);
    expect(isRecovery("lapsed_wau", "new")).toBe(false);
    expect(isRecovery("lapsed_dau4", "new")).toBe(false);
  });
  it("never treats lapsed→lapsed as a recovery", () => {
    expect(isRecovery("lapsed_mau", "lapsed_wau")).toBe(false);
    expect(isRecovery("lapsed_dau4", "lapsed_dau4")).toBe(false);
  });
});
