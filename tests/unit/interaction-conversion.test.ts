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

  it("Type B credits a false→true transition during ownership", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: true },
      stored: { votd_share_has_ever_flag: false },
      enrollmentFlags: { votd_share_has_ever_flag: false },
      goals: [goal("votd_share_has_ever_flag", "any_interaction")],
    });
    expect(out).toEqual(["votd_share_has_ever_flag"]);
  });

  it("Type B credits when the flag was absent from stored attributes (first observation true)", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: true },
      stored: {},
      enrollmentFlags: { votd_share_has_ever_flag: false },
      goals: [goal("votd_share_has_ever_flag", "any_interaction")],
    });
    expect(out).toEqual(["votd_share_has_ever_flag"]);
  });

  // Regression (2026-06-09 audit, C2): a has-ever flag that stays true used to
  // re-credit the same conversion on every subsequent sync, and users already
  // engaged before enrollment were credited on their first post-enroll sync.
  it("Type B does NOT re-credit when the flag was already true (no transition)", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: true },
      stored: { votd_share_has_ever_flag: true },
      enrollmentFlags: { votd_share_has_ever_flag: false },
      goals: [goal("votd_share_has_ever_flag", "any_interaction")],
    });
    expect(out).toEqual([]);
  });

  it("Type B does NOT credit a user whose flag was already true at enrollment", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: true },
      stored: { votd_share_has_ever_flag: true },
      enrollmentFlags: { votd_share_has_ever_flag: true },
      goals: [goal("votd_share_has_ever_flag", "any_interaction")],
    });
    expect(out).toEqual([]);
  });

  it("Type B tolerates string/number flag encodings in stored attributes", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: "true" },
      stored: { votd_share_has_ever_flag: "false" },
      enrollmentFlags: {},
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
