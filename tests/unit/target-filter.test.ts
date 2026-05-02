import { describe, expect, it } from "bun:test";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";

const baseComputed = {
  last_seen_days: 5,
  total_decisions: 10,
  total_conversions: 2,
  persona_confidence: 0.8,
};

const makeUser = (overrides: Partial<{
  updatedAt: Date;
  totalDecisions: number;
  totalConversions: number;
  personaConfidence: number | null;
}> = {}) => ({
  updatedAt: overrides.updatedAt ?? new Date(),
  totalDecisions: overrides.totalDecisions ?? 0,
  totalConversions: overrides.totalConversions ?? 0,
  personaConfidence: overrides.personaConfidence ?? null,
});

describe("evaluateTargetFilter", () => {
  it("empty filter matches any user", () => {
    expect(evaluateTargetFilter({}, { attributes: {}, computed: baseComputed })).toBe(true);
  });

  it("__gte: passes when value >= threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__gte: fails when value < threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 6 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__lte: passes when value <= threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lte: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__lte: fails when value > threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lte: 4 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__gt: passes when value > threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gt: 4 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__gt: fails when value == threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gt: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__lt: passes when value < threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lt: 6 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__lt: fails when value == threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lt: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__eq (suffix): passes on exact match", () => {
    expect(evaluateTargetFilter(
      { total_decisions__eq: 10 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("no suffix is shorthand for __eq", () => {
    expect(evaluateTargetFilter(
      { total_decisions: 10 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("no suffix __eq: fails on mismatch", () => {
    expect(evaluateTargetFilter(
      { total_decisions: 99 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__neq: passes when values differ", () => {
    expect(evaluateTargetFilter(
      { total_decisions__neq: 99 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__neq: fails when values are equal", () => {
    expect(evaluateTargetFilter(
      { total_decisions__neq: 10 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__exists true: passes when attribute is present and non-null", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: true },
      { attributes: { giver_tier: "sower" }, computed: baseComputed }
    )).toBe(true);
  });

  it("__exists true: fails when attribute is absent", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: true },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__exists false: passes when attribute is absent", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: false },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__exists false: fails when attribute is present", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: false },
      { attributes: { giver_tier: "sower" }, computed: baseComputed }
    )).toBe(false);
  });

  it("__in: passes when value is in the array", () => {
    expect(evaluateTargetFilter(
      { streak_status__in: ["active", "at_risk"] },
      { attributes: { streak_status: "active" }, computed: baseComputed }
    )).toBe(true);
  });

  it("__in: fails when value is not in the array", () => {
    expect(evaluateTargetFilter(
      { streak_status__in: ["active", "at_risk"] },
      { attributes: { streak_status: "broken" }, computed: baseComputed }
    )).toBe(false);
  });

  it("AND logic: all conditions must pass", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 3, total_decisions__gte: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("AND logic: one failing condition fails the whole filter", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 3, total_decisions__gte: 100 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("unknown key returns false (no attribute or computed match)", () => {
    expect(evaluateTargetFilter(
      { nonexistent_key__gte: 1 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("attribute keys are checked when not in computed", () => {
    expect(evaluateTargetFilter(
      { giver_tier: "sower" },
      { attributes: { giver_tier: "sower" }, computed: baseComputed }
    )).toBe(true);
  });

  it("computed keys override attributes of the same name", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 3 },
      { attributes: { last_seen_days: 0 }, computed: baseComputed }
    )).toBe(true); // computed.last_seen_days = 5, passes
  });
});

describe("buildComputedKeys", () => {
  it("last_seen_days is derived from updatedAt", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 1000);
    const result = buildComputedKeys(makeUser({ updatedAt: twoDaysAgo }));
    expect(result.last_seen_days).toBe(2);
  });

  it("persona_confidence defaults to 0 when null", () => {
    const result = buildComputedKeys(makeUser({ personaConfidence: null }));
    expect(result.persona_confidence).toBe(0);
  });

  it("maps totalDecisions and totalConversions directly", () => {
    const result = buildComputedKeys(makeUser({ totalDecisions: 7, totalConversions: 3 }));
    expect(result.total_decisions).toBe(7);
    expect(result.total_conversions).toBe(3);
  });
});
