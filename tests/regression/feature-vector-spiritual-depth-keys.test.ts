// tests/regression/feature-vector-spiritual-depth-keys.test.ts
//
// REGRESSION (audit 2026-10-13, spec §2 "Spiritual depth reads missing keys"):
// dim [8] read gp_current_month_count / gs_current_month_count /
// badge_lifetime_count, but ingest + every Hightouch template only send the
// *_current_year_count keys, so 3 of 5 inputs were always 0 in production.
// Fix: fall back to the year counts as a daily rate (count / day-of-year).
import { describe, expect, it } from "bun:test";
import { computeFeatureVector, dayOfYearUtc } from "@/lib/engine/feature-vector";
import type { UserStatsInput } from "@/lib/engine/feature-vector";

const base: UserStatsInput = {
  totalDecisions: 0, totalConversions: 0, totalReward: 0,
  channelStats: {}, hourlyStats: [], dailyStats: [],
};
const MAY_30 = new Date("2026-05-30T12:00:00Z"); // day 150

describe("regression: spiritual depth uses the keys Hightouch sends", () => {
  it("dayOfYearUtc is 1-based", () => {
    expect(dayOfYearUtc(new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(dayOfYearUtc(MAY_30)).toBe(150);
  });

  it("year-count keys contribute when month/lifetime keys are absent", () => {
    const attrs = { gp_current_year_count: 75, gs_current_year_count: 150, badge_current_year_count: 10 };
    const v = computeFeatureVector({ ...base, attributes: attrs, asOf: MAY_30 })[8];
    const prayer = 75 / 150;
    const scripture = Math.min(1, 150 / 150);
    const badge = Math.log(1 + 10) / Math.log(201);
    expect(v).toBeCloseTo((prayer + scripture + badge) / 5, 6);
  });

  it("month/lifetime keys win when present", () => {
    const attrs = { gp_current_month_count: 15, gp_current_year_count: 999 };
    const v = computeFeatureVector({ ...base, attributes: attrs, asOf: MAY_30 })[8];
    expect(v).toBeCloseTo((15 / 30) / 5, 6);
  });

  it("string values and Jan 1 stay finite and in [0,1]", () => {
    const attrs = { gp_current_year_count: "3", gs_current_year_count: "12", badge_current_year_count: "4" };
    const v = computeFeatureVector({ ...base, attributes: attrs, asOf: new Date("2026-01-01T08:00:00Z") })[8];
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("without asOf the year count is divided by 365", () => {
    const v = computeFeatureVector({ ...base, attributes: { gp_current_year_count: 73 } })[8];
    expect(v).toBeCloseTo((73 / 365) / 5, 6);
  });
});
