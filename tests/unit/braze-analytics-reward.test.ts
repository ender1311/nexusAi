/**
 * Unit tests for the click-based reward/punishment logic used in
 * cron/ingest-braze-analytics.
 *
 * The logic lives inline in the route, so we test the formula directly here
 * as a specification / regression guard.
 */

import { describe, test, expect } from "bun:test";

// ── Mirror the constants from the route ──────────────────────────────────────
// click_rate from Braze is 0–100 (percentage); 20% CTR → max reward (0.8)
const CLICK_REWARD_SCALE     = 0.04;
const CLICK_REWARD_MAX       = 0.8;
const OPEN_NO_CLICK_PENALTY  = 0.15;
const NO_ENGAGE_PENALTY      = 0.35;

function computeReward(clickRate: number, openRate: number): {
  reward: number;
  deltaAlpha: number;
  deltaBeta: number;
} {
  if (clickRate > 0) {
    const reward = Math.min(CLICK_REWARD_MAX, clickRate * CLICK_REWARD_SCALE);
    return { reward, deltaAlpha: reward, deltaBeta: 0 };
  } else if (openRate > 0) {
    return { reward: -OPEN_NO_CLICK_PENALTY, deltaAlpha: 0, deltaBeta: OPEN_NO_CLICK_PENALTY };
  } else {
    return { reward: -NO_ENGAGE_PENALTY, deltaAlpha: 0, deltaBeta: NO_ENGAGE_PENALTY };
  }
}

describe("braze analytics reward formula", () => {
  test("high click rate → positive reward capped at 0.8", () => {
    const { reward, deltaAlpha, deltaBeta } = computeReward(50, 60);
    expect(reward).toBe(CLICK_REWARD_MAX);
    expect(deltaAlpha).toBe(CLICK_REWARD_MAX);
    expect(deltaBeta).toBe(0);
  });

  test("moderate click rate (5%) → reward scaled proportionally", () => {
    const { reward, deltaAlpha, deltaBeta } = computeReward(5, 20);
    expect(reward).toBeCloseTo(0.2, 5);
    expect(deltaAlpha).toBeCloseTo(0.2, 5);
    expect(deltaBeta).toBe(0);
  });

  test("very low click rate (1%) → small positive reward", () => {
    const { reward } = computeReward(1, 10);
    expect(reward).toBeCloseTo(0.04, 5);
    expect(reward).toBeGreaterThan(0);
  });

  test("click rate 20% → reward exactly at cap", () => {
    const { reward } = computeReward(20, 30);
    expect(reward).toBe(CLICK_REWARD_MAX); // 20 * 0.04 = 0.8 = cap
  });

  test("zero clicks but positive opens → mild punishment", () => {
    const { reward, deltaAlpha, deltaBeta } = computeReward(0, 15);
    expect(reward).toBe(-OPEN_NO_CLICK_PENALTY);
    expect(deltaAlpha).toBe(0);
    expect(deltaBeta).toBe(OPEN_NO_CLICK_PENALTY);
  });

  test("zero clicks, zero opens → stronger punishment", () => {
    const { reward, deltaAlpha, deltaBeta } = computeReward(0, 0);
    expect(reward).toBe(-NO_ENGAGE_PENALTY);
    expect(deltaAlpha).toBe(0);
    expect(deltaBeta).toBe(NO_ENGAGE_PENALTY);
  });

  test("no-engage punishment is stronger than open-no-click penalty", () => {
    expect(NO_ENGAGE_PENALTY).toBeGreaterThan(OPEN_NO_CLICK_PENALTY);
  });

  test("click reward always positive, penalties always negative reward value", () => {
    expect(computeReward(10, 20).reward).toBeGreaterThan(0);
    expect(computeReward(0, 10).reward).toBeLessThan(0);
    expect(computeReward(0, 0).reward).toBeLessThan(0);
  });

  test("deltaWins signal: clicks → 1, no-click → 0", () => {
    // The route sets deltaWins = clickRate > 0 ? 1 : 0
    const withClick    = computeReward(5, 10);
    const withoutClick = computeReward(0, 10);
    expect(withClick.deltaAlpha).toBeGreaterThan(0);    // wins increment
    expect(withoutClick.deltaAlpha).toBe(0);            // no wins
    expect(withoutClick.deltaBeta).toBeGreaterThan(0);  // losses increment
  });
});
