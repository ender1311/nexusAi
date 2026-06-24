// Unit tests for agentTargetingLabel — the text shown in the agent-card
// targeting badge. Guards the precedence (segment over funnel stage), the
// label lookup, and the fallbacks so the badge never renders empty.
import { describe, expect, it } from "bun:test";
import { agentTargetingLabel } from "@/types/agent";

describe("agentTargetingLabel", () => {
  it("prefers a named segment over the funnel stage", () => {
    expect(agentTargetingLabel({ targetSegmentName: "VIP donors", funnelStage: "wau" }))
      .toBe("Segment: VIP donors");
  });

  it("prefers Hightouch segment includes over the funnel stage", () => {
    // Regression: Iris targets an HT segment but kept its default funnelStage
    // "wau", so the badge wrongly read "WAU" instead of the segment it targets.
    expect(agentTargetingLabel({
      funnelStage: "wau",
      segmentTargeting: { includes: ["new_user_21day_10percent"] },
    })).toBe("new_user_21day_10percent");
  });

  it("summarizes multiple includes as first +N", () => {
    expect(agentTargetingLabel({
      funnelStage: "wau",
      segmentTargeting: { includes: ["seg_a", "seg_b", "seg_c"] },
    })).toBe("seg_a +2");
  });

  it("ignores empty segment includes and falls through to funnel stage", () => {
    expect(agentTargetingLabel({ funnelStage: "dau4", segmentTargeting: { includes: [] } }))
      .toBe("DAU4");
  });

  it("maps a known funnel stage to its label", () => {
    expect(agentTargetingLabel({ funnelStage: "lapsed_wau" })).toBe("Lapsed WAU");
    expect(agentTargetingLabel({ funnelStage: "dau4" })).toBe("DAU4");
  });

  it("falls back to the raw value for an unknown funnel stage", () => {
    expect(agentTargetingLabel({ funnelStage: "lapsed_dau" })).toBe("lapsed_dau");
  });

  it("returns a dash when there's no segment and no funnel stage", () => {
    expect(agentTargetingLabel({ targetSegmentName: null, funnelStage: null })).toBe("—");
    expect(agentTargetingLabel({})).toBe("—");
  });
});
