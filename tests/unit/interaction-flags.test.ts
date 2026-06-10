import { describe, expect, it } from "bun:test";
import {
  INTERACTION_FLAGS,
  detectTransitionedFlags,
  FLAG_ATTRIBUTION_WINDOW_MS,
  isInteractionFlag,
  normalizeFlag,
  snapshotEnrollmentFlags,
} from "@/lib/constants/interaction-flags";

describe("interaction flags", () => {
  it("lists exactly the 9 has_ever flags", () => {
    expect(INTERACTION_FLAGS).toHaveLength(9);
    expect(INTERACTION_FLAGS).toContain("plan_interaction_has_ever_flag");
    expect(INTERACTION_FLAGS.every((f) => f.endsWith("_flag"))).toBe(true);
  });
  it("recognizes a flag name", () => {
    expect(isInteractionFlag("votd_share_has_ever_flag")).toBe(true);
    expect(isInteractionFlag("not_a_flag")).toBe(false);
  });
  it("normalizes truthy variants Hightouch may send", () => {
    expect(normalizeFlag(true)).toBe(true);
    expect(normalizeFlag("true")).toBe(true);
    expect(normalizeFlag("yes")).toBe(true);
    expect(normalizeFlag("t")).toBe(true);
    expect(normalizeFlag(1)).toBe(true);
    expect(normalizeFlag(false)).toBe(false);
    expect(normalizeFlag("false")).toBe(false);
    expect(normalizeFlag(0)).toBe(false);
    expect(normalizeFlag(null)).toBe(false);
    expect(normalizeFlag(undefined)).toBe(false);
  });
});

describe("snapshotEnrollmentFlags", () => {
  it("always contains all 9 flags, defaulting to false", () => {
    const snap = snapshotEnrollmentFlags("{}");
    expect(Object.keys(snap).sort()).toEqual([...INTERACTION_FLAGS].sort());
    expect(Object.values(snap).every((v) => v === false)).toBe(true);
  });

  it("normalizes truthy variants from a serialized JSON string", () => {
    const snap = snapshotEnrollmentFlags(JSON.stringify({
      plan_interaction_has_ever_flag: "true",
      votd_share_has_ever_flag: 1,
      guided_prayer_interaction_has_ever_flag: false,
      not_a_flag: true,
    }));
    expect(snap.plan_interaction_has_ever_flag).toBe(true);
    expect(snap.votd_share_has_ever_flag).toBe(true);
    expect(snap.guided_prayer_interaction_has_ever_flag).toBe(false);
    expect("not_a_flag" in snap).toBe(false);
  });

  it("accepts an already-parsed attributes object", () => {
    const snap = snapshotEnrollmentFlags({ votd_interaction_has_ever_flag: true });
    expect(snap.votd_interaction_has_ever_flag).toBe(true);
    expect(snap.plan_subscribed_has_ever_flag).toBe(false);
  });

  it("degrades corrupt, null, or non-object input to an all-false baseline", () => {
    for (const bad of ["{not json", null, undefined, 42, ["a"], JSON.stringify(["a"])]) {
      const snap = snapshotEnrollmentFlags(bad);
      expect(Object.keys(snap)).toHaveLength(9);
      expect(Object.values(snap).every((v) => v === false)).toBe(true);
    }
  });
});

describe("detectTransitionedFlags", () => {
  it("returns flags that flipped false/absent → true this sync", () => {
    const res = detectTransitionedFlags(
      { votd_interaction_has_ever_flag: true, plan_interaction_has_ever_flag: true },
      { plan_interaction_has_ever_flag: true }, // already true — no transition
    );
    expect(res).toEqual(["votd_interaction_has_ever_flag"]);
  });

  it("absent incoming or false incoming is never a transition", () => {
    expect(detectTransitionedFlags({}, {})).toEqual([]);
    expect(detectTransitionedFlags({ votd_interaction_has_ever_flag: false }, {})).toEqual([]);
  });

  it("is type-tolerant on both sides (string/int forms)", () => {
    expect(
      detectTransitionedFlags(
        { votd_interaction_has_ever_flag: "true" },
        { votd_interaction_has_ever_flag: "false" },
      ),
    ).toEqual(["votd_interaction_has_ever_flag"]);
    expect(
      detectTransitionedFlags(
        { votd_interaction_has_ever_flag: 1 },
        { votd_interaction_has_ever_flag: "t" }, // stored already truthy
      ),
    ).toEqual([]);
  });

  it("ignores non-flag keys", () => {
    expect(detectTransitionedFlags({ some_other_flag: true }, {})).toEqual([]);
  });
});

describe("FLAG_ATTRIBUTION_WINDOW_MS", () => {
  it("is 30 days", () => {
    expect(FLAG_ATTRIBUTION_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
