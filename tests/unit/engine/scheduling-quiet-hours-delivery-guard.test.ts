// Regression: the quiet hours pre-filter checks whether the user is in quiet hours
// *at cron run time*, not at delivery time. A user at 9pm ET passes the filter but
// a preferredSendHour that maps to 11pm ET would land inside quiet hours. The fix
// re-checks isInQuietHours at scheduledAt and falls back to in_local_time when the
// delivery time itself would be in quiet hours.
import { describe, expect, it } from "bun:test";
import { computeScheduledAt, isInQuietHours } from "@/lib/engine/scheduling";

describe("isInQuietHours — overnight window (22:00–08:00)", () => {
  it("returns true for a time clearly inside the quiet window (midnight)", () => {
    const midnight = new Date("2026-06-01T00:00:00.000Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", midnight)).toBe(true);
  });

  it("returns true at the exact start of quiet hours (22:00)", () => {
    const start = new Date("2026-06-01T22:00:00.000Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", start)).toBe(true);
  });

  it("returns false just before quiet hours start (21:59)", () => {
    const before = new Date("2026-06-01T21:59:00.000Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", before)).toBe(false);
  });

  it("returns true at 07:59 (inside the quiet window near the end)", () => {
    const nearEnd = new Date("2026-06-01T07:59:00.000Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", nearEnd)).toBe(true);
  });

  it("returns false at exactly 08:00 (end is exclusive)", () => {
    const end = new Date("2026-06-01T08:00:00.000Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", end)).toBe(false);
  });
});

describe("quiet hours delivery-time guard — core scenario", () => {
  // Scenario: quiet hours 22:00–08:00 UTC, cron runs at 21:30 UTC.
  // A user with preferredSendHour = 23 would be scheduled for 22:50 UTC.
  // 21:30 UTC is outside quiet hours → passes the pre-filter.
  // 22:50 UTC IS inside quiet hours → the guard should trigger.
  const now = new Date("2026-06-01T21:30:00.000Z");

  it("computeScheduledAt schedules at 22:50 UTC for preferredSendHour=23", () => {
    const { scheduledAt, inLocalTime } = computeScheduledAt(23, null, 8, now);
    expect(inLocalTime).toBe(false);
    expect(scheduledAt.getUTCHours()).toBe(22);
    expect(scheduledAt.getUTCMinutes()).toBe(50);
  });

  it("the scheduled delivery time (22:50 UTC) IS in quiet hours → guard must kick in", () => {
    const { scheduledAt, inLocalTime } = computeScheduledAt(23, null, 8, now);
    expect(inLocalTime).toBe(false);
    // The guard condition the cron now checks:
    const wouldViolate = isInQuietHours("22:00", "08:00", "UTC", scheduledAt);
    expect(wouldViolate).toBe(true);
  });

  it("re-computing with null preferredHour returns in_local_time fallback", () => {
    const { inLocalTime: fallbackFlag } = computeScheduledAt(null, null, 8, now);
    expect(fallbackFlag).toBe(true);
  });

  it("cron-time check does NOT fire at 21:30 (user would pass the pre-filter)", () => {
    const passesPreFilter = !isInQuietHours("22:00", "08:00", "UTC", now);
    expect(passesPreFilter).toBe(true);
  });
});

describe("quiet hours delivery-time guard — ET timezone (America/New_York)", () => {
  // 01:00 UTC = 9pm ET (UTC-4 summer): outside quiet hours → passes pre-filter.
  // preferredSendHour=3 (3am UTC) → 02:50 UTC = 10:50pm ET → inside quiet hours.
  const now = new Date("2026-06-01T01:00:00.000Z"); // 9pm ET

  it("cron at 9pm ET (01:00 UTC) is outside quiet hours (passes pre-filter)", () => {
    expect(isInQuietHours("22:00", "08:00", "America/New_York", now)).toBe(false);
  });

  it("delivery at 02:50 UTC (10:50pm ET) IS in quiet hours", () => {
    const { scheduledAt, inLocalTime } = computeScheduledAt(3, null, 8, now);
    expect(inLocalTime).toBe(false);
    expect(scheduledAt.getUTCHours()).toBe(2);
    expect(scheduledAt.getUTCMinutes()).toBe(50);
    expect(isInQuietHours("22:00", "08:00", "America/New_York", scheduledAt)).toBe(true);
  });
});

describe("quiet hours delivery-time guard — no false positives", () => {
  const now = new Date("2026-06-01T14:00:00.000Z"); // 2pm UTC, midday

  it("a send landing at 3pm UTC is not in 22:00–08:00 quiet hours", () => {
    const { scheduledAt, inLocalTime } = computeScheduledAt(15, null, 8, now);
    expect(inLocalTime).toBe(false);
    expect(isInQuietHours("22:00", "08:00", "UTC", scheduledAt)).toBe(false);
  });

  it("a fallback (in_local_time) send should not trigger the guard (isFallback=true)", () => {
    const { inLocalTime } = computeScheduledAt(null, null, 8, now);
    expect(inLocalTime).toBe(true);
    // Guard is only applied when !isFallback — this is enforced in the cron by the
    // `if (!isFallback && ...)` condition.
  });
});
