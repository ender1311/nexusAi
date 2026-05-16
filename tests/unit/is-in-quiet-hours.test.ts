import { describe, expect, it } from "bun:test";
import { isInQuietHours } from "@/lib/engine/scheduling";

// Fixed reference time: 2026-05-07T02:00:00Z (10:00 PM ET = inside 21:00–06:00 quiet window)
const NIGHT_UTC = new Date("2026-05-07T02:00:00Z");
// Daytime reference: 2026-05-07T15:00:00Z (11:00 AM ET = outside quiet window)
const DAY_UTC = new Date("2026-05-07T15:00:00Z");

describe("isInQuietHours", () => {
  it("returns true when now is inside an overnight quiet window (start > end)", () => {
    // 22:00 ET = 02:00 UTC — inside 21:00–06:00 ET quiet window
    expect(isInQuietHours("21:00", "06:00", "America/New_York", NIGHT_UTC)).toBe(true);
  });

  it("returns false when now is outside an overnight quiet window", () => {
    // 11:00 ET = 15:00 UTC — outside 21:00–06:00 ET
    expect(isInQuietHours("21:00", "06:00", "America/New_York", DAY_UTC)).toBe(false);
  });

  it("returns true when now is inside a same-day quiet window (start < end)", () => {
    // DAY_UTC = 15:00 UTC = 11:00 AM ET — inside 10:00–14:00 ET window
    expect(isInQuietHours("10:00", "14:00", "America/New_York", DAY_UTC)).toBe(true);
    // 17:00 UTC = 13:00 ET — also inside 10:00–14:00 ET
    const also_inside = new Date("2026-05-07T17:00:00Z");
    expect(isInQuietHours("10:00", "14:00", "America/New_York", also_inside)).toBe(true);
    // 20:00 UTC = 16:00 ET — outside 10:00–14:00 ET
    const outside = new Date("2026-05-07T20:00:00Z");
    expect(isInQuietHours("10:00", "14:00", "America/New_York", outside)).toBe(false);
  });

  it("returns false for unknown/invalid timezone instead of throwing", () => {
    expect(isInQuietHours("21:00", "06:00", "Not/ATimezone", NIGHT_UTC)).toBe(false);
  });

  it("respects timezone differences — same UTC, different local result", () => {
    // 02:00 UTC = 22:00 ET (inside 21:00–06:00) but = 09:00 IST (outside)
    expect(isInQuietHours("21:00", "06:00", "America/New_York", NIGHT_UTC)).toBe(true);
    expect(isInQuietHours("21:00", "06:00", "Asia/Kolkata",     NIGHT_UTC)).toBe(false);
  });

  it("treats start boundary as inclusive and end boundary as exclusive", () => {
    // exactly at start = 21:00 ET → 01:00 UTC (next day)
    const atStart = new Date("2026-05-07T01:00:00Z"); // 21:00 ET
    expect(isInQuietHours("21:00", "06:00", "America/New_York", atStart)).toBe(true);
    // exactly at end = 06:00 ET → 10:00 UTC
    const atEnd = new Date("2026-05-07T10:00:00Z"); // 06:00 ET
    expect(isInQuietHours("21:00", "06:00", "America/New_York", atEnd)).toBe(false);
  });
});
