import { describe, expect, it } from "bun:test";
import { detectFlagConversions } from "@/lib/services/interaction-conversion";

const goal = (eventName: string, conversionType: string | null) =>
  ({ eventName, conversionType } as { eventName: string; conversionType: string | null });

describe("detectFlagConversions", () => {
  it("Type A credits a genuine first interaction (baseline false → now true)", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: { plan_interaction_has_ever_flag: false },
      enrollmentFlags: { plan_interaction_has_ever_flag: false },
      goals: [goal("plan_interaction_has_ever_flag", "first_interaction")],
    });
    expect(out).toEqual(["plan_interaction_has_ever_flag"]);
  });

  it("Type A does NOT credit when the user was already interacted at enrollment", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: { plan_interaction_has_ever_flag: false },
      enrollmentFlags: { plan_interaction_has_ever_flag: true }, // already true at enroll
      goals: [goal("plan_interaction_has_ever_flag", "first_interaction")],
    });
    expect(out).toEqual([]);
  });

  it("Type B credits when the flag is true during ownership regardless of baseline", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: true },
      stored: { votd_share_has_ever_flag: true },         // already true, no transition
      enrollmentFlags: { votd_share_has_ever_flag: true },
      goals: [goal("votd_share_has_ever_flag", "any_interaction")],
    });
    expect(out).toEqual(["votd_share_has_ever_flag"]);
  });

  it("does not credit a flag the agent has no goal for", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: { plan_interaction_has_ever_flag: false },
      enrollmentFlags: { plan_interaction_has_ever_flag: false },
      goals: [goal("votd_share_has_ever_flag", "first_interaction")],
    });
    expect(out).toEqual([]);
  });

  it("ignores normal event goals (conversionType null)", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: {},
      enrollmentFlags: {},
      goals: [goal("plan_interaction_has_ever_flag", null)],
    });
    expect(out).toEqual([]);
  });
});
