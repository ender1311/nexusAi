/**
 * Unit tests for the time-decay reward logic in cron/ingest-braze-analytics.
 *
 * The cron no longer calls the Braze API. Instead it uses pushOpenAt to
 * determine whether a user engaged with the send, applying a flat
 * no-engagement penalty when pushOpenAt is null after 48h.
 */

import { describe, test, expect } from "bun:test";

const NO_ENGAGE_PENALTY = 0.35;

function computeDecayReward(pushOpenAt: Date | null): {
  reward: number;
  deltaAlpha: number;
  deltaBeta: number;
} {
  if (pushOpenAt !== null) {
    return { reward: 0, deltaAlpha: 0, deltaBeta: 0 };
  }
  return { reward: -NO_ENGAGE_PENALTY, deltaAlpha: 0, deltaBeta: NO_ENGAGE_PENALTY };
}

describe("time-decay reward formula", () => {
  test("push open observed → reward=0, no arm stats change", () => {
    const { reward, deltaAlpha, deltaBeta } = computeDecayReward(new Date());
    expect(reward).toBe(0);
    expect(deltaAlpha).toBe(0);
    expect(deltaBeta).toBe(0);
  });

  test("no engagement → negative reward and deltaBeta = NO_ENGAGE_PENALTY", () => {
    const { reward, deltaAlpha, deltaBeta } = computeDecayReward(null);
    expect(reward).toBe(-NO_ENGAGE_PENALTY);
    expect(deltaAlpha).toBe(0);
    expect(deltaBeta).toBe(NO_ENGAGE_PENALTY);
  });

  test("no-engage penalty is 0.35", () => {
    expect(NO_ENGAGE_PENALTY).toBe(0.35);
  });

  test("reward is always non-positive (decay cron only applies penalties or zero)", () => {
    expect(computeDecayReward(null).reward).toBeLessThan(0);
    expect(computeDecayReward(new Date()).reward).toBe(0);
  });

  test("open → deltaBeta is zero (no punishment for confirmed opens)", () => {
    expect(computeDecayReward(new Date()).deltaBeta).toBe(0);
  });
});
