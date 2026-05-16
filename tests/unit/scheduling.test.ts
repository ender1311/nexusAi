import { describe, expect, it } from "bun:test";
import { getTodayStartUTC, isInQuietHours, peakActivityHour } from "@/lib/engine/scheduling";

describe("peakActivityHour", () => {
  it("returns null for an all-zero array (no conversion data)", () => {
    expect(peakActivityHour(Array(24).fill(0))).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(peakActivityHour([])).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(peakActivityHour(null)).toBeNull();
    expect(peakActivityHour(undefined)).toBeNull();
    expect(peakActivityHour("bad")).toBeNull();
  });

  it("returns the index of the single peak hour", () => {
    const stats = Array(24).fill(0);
    stats[14] = 5; // 14:00 UTC has 5 conversions
    expect(peakActivityHour(stats)).toBe(14);
  });

  it("returns the first occurrence when two hours tie for the peak", () => {
    const stats = Array(24).fill(0);
    stats[10] = 3;
    stats[20] = 3;
    expect(peakActivityHour(stats)).toBe(10);
  });

  it("returns hour 0 when midnight is the peak", () => {
    const stats = Array(24).fill(0);
    stats[0] = 7;
    expect(peakActivityHour(stats)).toBe(0);
  });

  it("ignores values beyond index 23", () => {
    const stats = Array(30).fill(0);
    stats[25] = 99; // outside valid 0-23 range
    stats[12] = 1;
    expect(peakActivityHour(stats)).toBe(12);
  });
});

describe("getTodayStartUTC", () => {
  it("returns midnight ET (EDT, UTC-4) on a standard summer day", () => {
    // 2026-05-02T14:00:00Z → today in ET is May 2; midnight ET = 04:00 UTC
    const now = new Date("2026-05-02T14:00:00Z");
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-05-02T04:00:00.000Z")
    );
  });

  it("returns midnight ET (EST, UTC-5) on a standard winter day", () => {
    // 2026-01-15T14:00:00Z → today in ET is Jan 15; midnight ET = 05:00 UTC
    const now = new Date("2026-01-15T14:00:00Z");
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-01-15T05:00:00.000Z")
    );
  });

  it("handles midnight UTC edge case: 00:30 UTC is prior evening ET", () => {
    // 2026-05-02T00:30:00Z → EDT (UTC-4) = 2026-05-01T20:30 ET
    // today in ET = May 1; midnight ET = 2026-05-01T04:00:00Z
    const now = new Date("2026-05-02T00:30:00Z");
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-05-01T04:00:00.000Z")
    );
  });

  it("returns midnight ET across DST spring-forward (2026-03-08, clocks spring 02:00 EST → EDT)", () => {
    // Midnight Mar 8 is before the spring-forward (which happens at 02:00 AM EST = 07:00 UTC).
    // So midnight Mar 8 is still EST (UTC-5) → 05:00 UTC.
    const now = new Date("2026-03-08T14:00:00Z"); // well after spring-forward
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-03-08T05:00:00.000Z")
    );
  });

  it("returns midnight ET across DST fall-back (2026-11-01, clocks fall 02:00 EDT → EST)", () => {
    // Midnight Nov 1 is before the fall-back (which happens at 02:00 AM EDT = 06:00 UTC).
    // So midnight Nov 1 is still EDT (UTC-4) → 04:00 UTC.
    const now = new Date("2026-11-01T14:00:00Z"); // well after fall-back
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-11-01T04:00:00.000Z")
    );
  });

  it("works for UTC timezone (midnight UTC = midnight UTC)", () => {
    const now = new Date("2026-05-02T14:00:00Z");
    expect(getTodayStartUTC("UTC", now)).toEqual(new Date("2026-05-02T00:00:00.000Z"));
  });
});

describe("isInQuietHours", () => {
  describe("overnight window (start > end: 22:00 to 08:00)", () => {
    it("returns true at 23:00 UTC (within quiet hours)", () => {
      const now = new Date("2026-05-02T23:00:00Z");
      expect(isInQuietHours("22:00", "08:00", "UTC", now)).toBe(true);
    });

    it("returns true at 03:00 UTC (within quiet hours, before end)", () => {
      const now = new Date("2026-05-02T03:00:00Z");
      expect(isInQuietHours("22:00", "08:00", "UTC", now)).toBe(true);
    });

    it("returns false at 10:00 UTC (outside quiet hours)", () => {
      const now = new Date("2026-05-02T10:00:00Z");
      expect(isInQuietHours("22:00", "08:00", "UTC", now)).toBe(false);
    });

    it("returns true at 22:00 UTC exactly (boundary: inclusive start)", () => {
      const now = new Date("2026-05-02T22:00:00Z");
      expect(isInQuietHours("22:00", "08:00", "UTC", now)).toBe(true);
    });

    it("returns false at 08:00 UTC exactly (boundary: exclusive end)", () => {
      const now = new Date("2026-05-02T08:00:00Z");
      expect(isInQuietHours("22:00", "08:00", "UTC", now)).toBe(false);
    });
  });

  describe("same-day window (start <= end: 09:00 to 17:00)", () => {
    it("returns true at 12:00 UTC (within quiet hours)", () => {
      const now = new Date("2026-05-02T12:00:00Z");
      expect(isInQuietHours("09:00", "17:00", "UTC", now)).toBe(true);
    });

    it("returns false at 08:59 UTC (before start)", () => {
      const now = new Date("2026-05-02T08:59:00Z");
      expect(isInQuietHours("09:00", "17:00", "UTC", now)).toBe(false);
    });

    it("returns false at 17:00 UTC exactly (boundary: exclusive end)", () => {
      const now = new Date("2026-05-02T17:00:00Z");
      expect(isInQuietHours("09:00", "17:00", "UTC", now)).toBe(false);
    });

    it("returns true at 09:00 UTC exactly (boundary: inclusive start)", () => {
      const now = new Date("2026-05-02T09:00:00Z");
      expect(isInQuietHours("09:00", "17:00", "UTC", now)).toBe(true);
    });
  });

  describe("zero-width window (start === end)", () => {
    it("returns false when start === end (zero-width window never contains time)", () => {
      const now = new Date("2026-05-02T22:00:00Z");
      // start === end: start > end is false, so same-day logic applies:
      // "22:00" >= "22:00" && "22:00" < "22:00" = true && false = false
      expect(isInQuietHours("22:00", "22:00", "UTC", now)).toBe(false);
    });
  });

  describe("timezone conversion", () => {
    it("correctly interprets time in America/Los_Angeles (UTC-8 in January)", () => {
      // 2026-01-15T08:00:00Z = 00:00 PT (2026-01-15)
      // 09:00–17:00 PT: should be false (just before 09:00)
      const now = new Date("2026-01-15T08:00:00Z");
      expect(isInQuietHours("09:00", "17:00", "America/Los_Angeles", now)).toBe(false);
    });

    it("correctly interprets time in America/Los_Angeles during active hours", () => {
      // 2026-01-15T17:00:00Z = 09:00 PT (2026-01-15) — exactly at start
      // 09:00–17:00 PT: should be true
      const now = new Date("2026-01-15T17:00:00Z");
      expect(isInQuietHours("09:00", "17:00", "America/Los_Angeles", now)).toBe(true);
    });

    it("verifies timezone parameter matters: same UTC time in different timezones", () => {
      // Use a UTC time that will be in quiet hours for UTC but outside for a different timezone
      // 2026-05-02T14:00:00Z = 14:00 UTC = 06:00 PT (America/Los_Angeles, UTC-8 in May)
      // Quiet hours 22:00–08:00 PT: should be true (06:00 < 08:00)
      const now = new Date("2026-05-02T14:00:00Z");
      const inPT = isInQuietHours("22:00", "08:00", "America/Los_Angeles", now);
      const inUTC = isInQuietHours("22:00", "08:00", "UTC", now);
      // PT: 06:00 is in [22:00–08:00) overnight window (yes)
      // UTC: 14:00 is NOT in [22:00–08:00) overnight window (no)
      expect(inPT).toBe(true);
      expect(inUTC).toBe(false);
    });
  });
});
