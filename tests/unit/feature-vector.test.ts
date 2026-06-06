import { describe, expect, it } from "bun:test";
import { computeFeatureVector, cosineSimilarity, FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { UserStatsInput } from "@/lib/engine/feature-vector";

const emptyStats: UserStatsInput = {
  totalDecisions: 0, totalConversions: 0, totalReward: 0,
  channelStats: {}, hourlyStats: [], dailyStats: [],
};

describe("computeFeatureVector", () => {
  it(`returns array of ${FEATURE_DIM} elements`, () => {
    expect(computeFeatureVector(emptyStats)).toHaveLength(FEATURE_DIM);
  });

  it("all zeros for user with no data", () => {
    const vec = computeFeatureVector(emptyStats);
    expect(vec.every(v => v === 0)).toBe(true);
  });

  it("[0] push conversion rate", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: { push: { sent: 10, converted: 7 } },
    };
    expect(computeFeatureVector(stats)[0]).toBeCloseTo(0.7, 5);
  });

  it("[1] email conversion rate", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: { email: { sent: 5, converted: 1 } },
    };
    expect(computeFeatureVector(stats)[1]).toBeCloseTo(0.2, 5);
  });

  it("[0/1] zero sends → 0 (no division)", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: { push: { sent: 0, converted: 0 } },
    };
    expect(computeFeatureVector(stats)[0]).toBe(0);
  });

  it("[2] morning ratio — hours 5–11 share", () => {
    const hourlyStats = Array(24).fill(0);
    hourlyStats[9] = 3;   // 9 am — inside morning window
    hourlyStats[20] = 7;  // 8 pm — outside morning window
    const vec = computeFeatureVector({ ...emptyStats, hourlyStats });
    expect(vec[2]).toBeCloseTo(3 / 10, 5); // 3 out of 10 total
  });

  it("[3] evening ratio — hours 17–22 share", () => {
    const hourlyStats = Array(24).fill(0);
    hourlyStats[9]  = 3;  // 9 am — outside evening window
    hourlyStats[20] = 7;  // 8 pm — inside evening window
    const vec = computeFeatureVector({ ...emptyStats, hourlyStats });
    expect(vec[3]).toBeCloseTo(7 / 10, 5); // 7 out of 10 total
  });

  it("[2/3] zero hourly activity → both 0", () => {
    expect(computeFeatureVector(emptyStats)[2]).toBe(0);
    expect(computeFeatureVector(emptyStats)[3]).toBe(0);
  });

  it("[2] morning window boundary — hour 4 excluded, hour 5 included, hour 11 included, hour 12 excluded", () => {
    const build = (hour: number) => { const h = Array(24).fill(0); h[hour] = 1; return h; };
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(4)  })[2]).toBe(0);   // before morning
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(5)  })[2]).toBe(1);   // first morning hour
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(11) })[2]).toBe(1);   // last morning hour
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(12) })[2]).toBe(0);   // after morning
  });

  it("[3] evening window boundary — hour 16 excluded, hour 17 included, hour 22 included, hour 23 excluded", () => {
    const build = (hour: number) => { const h = Array(24).fill(0); h[hour] = 1; return h; };
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(16) })[3]).toBe(0);   // before evening
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(17) })[3]).toBe(1);   // first evening hour
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(22) })[3]).toBe(1);   // last evening hour
    expect(computeFeatureVector({ ...emptyStats, hourlyStats: build(23) })[3]).toBe(0);   // after evening
  });

  it("[4] weekend ratio — Sun (0) + Sat (6) share", () => {
    const dailyStats = Array(7).fill(0);
    dailyStats[0] = 2; // Sunday
    dailyStats[6] = 3; // Saturday
    dailyStats[1] = 5; // Monday — weekday
    const vec = computeFeatureVector({ ...emptyStats, dailyStats });
    expect(vec[4]).toBeCloseTo(5 / 10, 5); // (2+3) out of 10
  });

  it("[4] weekday-only activity → weekend ratio 0", () => {
    const dailyStats = Array(7).fill(0);
    dailyStats[1] = 5; // Monday
    dailyStats[3] = 3; // Wednesday
    expect(computeFeatureVector({ ...emptyStats, dailyStats })[4]).toBe(0);
  });

  it("[5] overall conversion rate", () => {
    const vec = computeFeatureVector({
      ...emptyStats,
      totalDecisions: 10,
      totalConversions: 4,
    });
    expect(vec[5]).toBeCloseTo(0.4, 5);
  });

  it("[5] is 0 when no decisions", () => {
    expect(computeFeatureVector(emptyStats)[5]).toBe(0);
  });

  it("[6] recency score — 0 days ago → 1.0", () => {
    const vec = computeFeatureVector({ ...emptyStats, attributes: { days_since_last_open: 0 } });
    expect(vec[6]).toBeCloseTo(1.0, 5);
  });

  it("[6] recency score — 90+ days ago → 0", () => {
    const vec = computeFeatureVector({ ...emptyStats, attributes: { days_since_last_open: 90 } });
    expect(vec[6]).toBeCloseTo(0, 5);
  });

  it("[6] recency absent → 0 (no signal)", () => {
    expect(computeFeatureVector(emptyStats)[6]).toBe(0);
  });

  it("[7] giving tier encoding", () => {
    const sower  = computeFeatureVector({ ...emptyStats, attributes: { giving_tier: "sower" } })[7];
    const giver  = computeFeatureVector({ ...emptyStats, attributes: { giving_tier: "giver" } })[7];
    const none   = computeFeatureVector({ ...emptyStats, attributes: { giving_tier: "none"  } })[7];
    expect(sower).toBeCloseTo(1.0, 5);
    expect(giver).toBeCloseTo(0.5, 5);
    expect(none).toBe(0);
  });

  it("[7] has_recurring_gift true maps to sower tier (1.0), type-tolerant", () => {
    // Authoritative recurring signal — counts as sower even without giving_tier.
    expect(computeFeatureVector({ ...emptyStats, attributes: { has_recurring_gift: true } })[7]).toBeCloseTo(1.0, 5);
    expect(computeFeatureVector({ ...emptyStats, attributes: { has_recurring_gift: "true" } })[7]).toBeCloseTo(1.0, 5);
    expect(computeFeatureVector({ ...emptyStats, attributes: { has_recurring_gift: 1 } })[7]).toBeCloseTo(1.0, 5);
    // Falsy variants do not promote: a plain "giver" stays 0.5, none stays 0.
    expect(computeFeatureVector({ ...emptyStats, attributes: { has_recurring_gift: "false", giving_tier: "giver" } })[7]).toBeCloseTo(0.5, 5);
    expect(computeFeatureVector({ ...emptyStats, attributes: { has_recurring_gift: 0 } })[7]).toBe(0);
  });

  it("[8] spiritual depth composite in [0,1]", () => {
    const attrs = {
      plan_day_current_month_count: 31,
      plan_finish_lifetime_count: 500,
      gp_current_month_count: 30,
      gs_current_month_count: 30,
      badge_lifetime_count: 200,
    };
    const val = computeFeatureVector({ ...emptyStats, attributes: attrs })[8];
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThanOrEqual(1);
  });

  it("[8] spiritual depth is 0 with no attributes", () => {
    expect(computeFeatureVector(emptyStats)[8]).toBe(0);
  });

  it("[8] spiritual depth with partial attributes — missing signals contribute 0", () => {
    // Only plan depth provided; other 4 signals default to 0 → composite = plan/5
    const plan = Math.log(1 + 100) / Math.log(501);
    const vec = computeFeatureVector({ ...emptyStats, attributes: { plan_finish_lifetime_count: 100 } });
    expect(vec[8]).toBeCloseTo(plan / 5, 5);
  });

  it("[9] engagement frequency increases with more decisions", () => {
    const low  = computeFeatureVector({ ...emptyStats, totalDecisions: 1   })[9];
    const high = computeFeatureVector({ ...emptyStats, totalDecisions: 100 })[9];
    expect(high).toBeGreaterThan(low);
  });
});

describe("cosineSimilarity", () => {
  it("identical vectors → 1.0", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("zero vector → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("mismatched length → 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("same direction, different magnitude → 1.0", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 5);
  });
});
