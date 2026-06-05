import { describe, it, expect } from "bun:test";
import {
  partitionByPreferredHour,
  trimToCap,
  resolveFetchLimit,
  MAX_FETCH_LIMIT,
} from "@/lib/cron/caps";

describe("resolveFetchLimit", () => {
  it("uses uniqueUsersCap when it is the larger driver (cohort needs N candidates)", () => {
    expect(resolveFetchLimit(500, 1000)).toBe(1000);
  });

  it("uses 2x dailySendCap when it exceeds uniqueUsersCap", () => {
    expect(resolveFetchLimit(800, 1000)).toBe(1600);
  });

  it("uses 2x dailySendCap when uniqueUsersCap is null", () => {
    expect(resolveFetchLimit(500, null)).toBe(1000);
  });

  it("uses uniqueUsersCap when dailySendCap is null", () => {
    expect(resolveFetchLimit(null, 1000)).toBe(1000);
  });

  it("falls back to the safety ceiling when both are null (explicit-unlimited)", () => {
    expect(resolveFetchLimit(null, null)).toBe(MAX_FETCH_LIMIT);
  });

  it("never exceeds the safety ceiling", () => {
    expect(resolveFetchLimit(null, 200_000)).toBe(MAX_FETCH_LIMIT);
  });
});

describe("trimToCap", () => {
  it("keeps everything when under quota", () => {
    expect(trimToCap(["a", "b"], 5)).toEqual({ kept: ["a", "b"], suppressed: 0 });
  });

  it("trims to the remaining quota and reports suppressed count", () => {
    expect(trimToCap(["a", "b", "c", "d"], 2)).toEqual({ kept: ["a", "b"], suppressed: 2 });
  });

  it("drops everything when remaining is zero or negative", () => {
    expect(trimToCap(["a", "b"], 0)).toEqual({ kept: [], suppressed: 2 });
    expect(trimToCap(["a", "b"], -3)).toEqual({ kept: [], suppressed: 2 });
  });
});

describe("partitionByPreferredHour", () => {
  it("returns everyone (no deferral) when prioritizeLastSeen is false", () => {
    const res = partitionByPreferredHour(["a", "b", "c"], {
      prioritizeLastSeen: false,
      currentHour: 12,
      preferredHourByUser: new Map(),
    });
    expect(res.kept.sort()).toEqual(["a", "b", "c"]);
    expect(res.deferred).toBe(0);
  });

  it("keeps time-matched + no-preference users, defers far-hour users (not suppressed)", () => {
    const preferred = new Map<string, number | null>([
      ["match-now", 12],
      ["match-adjacent", 13],
      ["far", 3],
      ["no-pref", null],
    ]);
    const res = partitionByPreferredHour(["match-now", "match-adjacent", "far", "no-pref"], {
      prioritizeLastSeen: true,
      currentHour: 12,
      preferredHourByUser: preferred,
    });
    expect(res.kept.sort()).toEqual(["match-adjacent", "match-now", "no-pref"]);
    expect(res.deferred).toBe(1);
  });

  it("wraps adjacency across midnight", () => {
    const preferred = new Map<string, number | null>([["late", 23]]);
    const res = partitionByPreferredHour(["late"], {
      prioritizeLastSeen: true,
      currentHour: 0,
      preferredHourByUser: preferred,
    });
    expect(res.kept).toEqual(["late"]);
    expect(res.deferred).toBe(0);
  });
});
