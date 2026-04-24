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

  it("channel affinity: push at [0], email at [1], sms at [2]", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: {
        push:  { sent: 10, converted: 7 },
        email: { sent: 5,  converted: 1 },
        sms:   { sent: 4,  converted: 2 },
      },
    };
    const vec = computeFeatureVector(stats);
    expect(vec[0]).toBeCloseTo(0.7, 5); // push: 7/10
    expect(vec[1]).toBeCloseTo(0.2, 5); // email: 1/5
    expect(vec[2]).toBeCloseTo(0.5, 5); // sms: 2/4
  });

  it("channel with zero sends contributes 0", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: { push: { sent: 0, converted: 0 } },
    };
    expect(computeFeatureVector(stats)[0]).toBe(0);
  });

  it("hourly curve at [3..26] is normalized (sums to 1 when non-zero)", () => {
    const hourlyStats = Array(24).fill(0);
    hourlyStats[9]  = 3;
    hourlyStats[14] = 7;
    const vec = computeFeatureVector({ ...emptyStats, hourlyStats });
    const sum = vec.slice(3, 27).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    expect(vec[3 + 9]).toBeCloseTo(0.3, 5);  // 3/(3+7)
    expect(vec[3 + 14]).toBeCloseTo(0.7, 5); // 7/(3+7)
  });

  it("daily curve at [27..33] is normalized", () => {
    const dailyStats = Array(7).fill(0);
    dailyStats[1] = 1; // Monday
    dailyStats[5] = 4; // Saturday
    const vec = computeFeatureVector({ ...emptyStats, dailyStats });
    const sum = vec.slice(27, 34).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("overall conversion rate at [34]", () => {
    const vec = computeFeatureVector({
      ...emptyStats,
      totalDecisions: 10,
      totalConversions: 4,
    });
    expect(vec[34]).toBeCloseTo(0.4, 5);
  });

  it("[34] is 0 when no decisions", () => {
    expect(computeFeatureVector(emptyStats)[34]).toBe(0);
  });

  it("[35] engagement frequency increases with more decisions", () => {
    const low  = computeFeatureVector({ ...emptyStats, totalDecisions: 1  })[35];
    const high = computeFeatureVector({ ...emptyStats, totalDecisions: 100 })[35];
    expect(high).toBeGreaterThan(low);
  });

  it("[36] avg reward magnitude capped at 1", () => {
    const vec = computeFeatureVector({
      ...emptyStats,
      totalConversions: 1,
      totalReward: 999,
    });
    expect(vec[36]).toBeLessThanOrEqual(1.0);
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
