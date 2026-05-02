import { describe, expect, it } from "bun:test";
import { computeSendTime, isTimingMatch } from "@/lib/engine/send-timing";

const zeroHours = Array(24).fill(0) as number[];
const zeroDays  = Array(7).fill(0)  as number[];

describe("computeSendTime", () => {
  it("returns fallback { hour: 9, dayOfWeek: 0 } when both stats are all zeros", () => {
    expect(computeSendTime(zeroHours, zeroDays, 0)).toEqual({ hour: 9, dayOfWeek: 0 });
  });

  it("returns fallback when hourlyStats is all zeros even if dailyStats has values", () => {
    const days = [0, 5, 3, 0, 0, 0, 0];
    expect(computeSendTime(zeroHours, days, 0)).toEqual({ hour: 9, dayOfWeek: 0 });
  });

  it("returns fallback when dailyStats is all zeros even if hourlyStats has values", () => {
    const hours = Array(24).fill(0) as number[];
    hours[10] = 8;
    expect(computeSendTime(hours, zeroDays, 0)).toEqual({ hour: 9, dayOfWeek: 0 });
  });

  it("returns peak hour and peak day for sendIndex 0 (primary)", () => {
    const hours = Array(24).fill(0) as number[];
    hours[14] = 10;  // peak at 14:00
    const days = Array(7).fill(0) as number[];
    days[3] = 5;     // peak on Wednesday (index 3)
    expect(computeSendTime(hours, days, 0)).toEqual({ hour: 14, dayOfWeek: 3 });
  });

  it("returns same primary peak for sendIndex 2", () => {
    const hours = Array(24).fill(0) as number[];
    hours[8] = 7;
    const days = Array(7).fill(0) as number[];
    days[1] = 4;
    expect(computeSendTime(hours, days, 2)).toEqual({ hour: 8, dayOfWeek: 1 });
  });

  it("returns secondary peak for sendIndex 1", () => {
    const hours = Array(24).fill(0) as number[];
    hours[9]  = 10;  // primary
    hours[18] = 7;   // secondary
    const days = Array(7).fill(0) as number[];
    days[0] = 8;     // primary (Sunday)
    days[4] = 5;     // secondary (Thursday)
    expect(computeSendTime(hours, days, 1)).toEqual({ hour: 18, dayOfWeek: 4 });
  });

  it("returns same secondary peak for sendIndex 3", () => {
    const hours = Array(24).fill(0) as number[];
    hours[9]  = 10;
    hours[18] = 7;
    const days = Array(7).fill(0) as number[];
    days[0] = 8;
    days[4] = 5;
    expect(computeSendTime(hours, days, 3)).toEqual({ hour: 18, dayOfWeek: 4 });
  });

  it("breaks ties by returning the first (lowest-index) maximum", () => {
    const hours = Array(24).fill(5) as number[];  // all equal
    const days  = Array(7).fill(5)  as number[];  // all equal
    expect(computeSendTime(hours, days, 0)).toEqual({ hour: 0, dayOfWeek: 0 });
  });

  it("secondary peak falls back to primary index when all values tie", () => {
    // If every hour has the same value, argSecondMax loops without finding
    // a different winner — it should return index 1 (the next non-primary slot)
    const hours = Array(24).fill(3) as number[];
    const days  = Array(7).fill(3)  as number[];
    // primary = index 0; secondary = index 1
    expect(computeSendTime(hours, days, 1)).toEqual({ hour: 1, dayOfWeek: 1 });
  });
});

describe("isTimingMatch", () => {
  it("returns true when both stats arrays are all-zero (fallback: always allow)", () => {
    expect(isTimingMatch(zeroHours, zeroDays, 0, 14, 3)).toBe(true);
  });

  it("returns true when hourlyStats is all-zero even if dailyStats has values", () => {
    const days = [0, 0, 0, 5, 0, 0, 0]; // peak Wednesday
    expect(isTimingMatch(zeroHours, days, 0, 14, 3)).toBe(true);
  });

  it("returns true when current hour and day exactly match primary peak (sendIndex 0)", () => {
    const hours = Array(24).fill(0) as number[];
    hours[14] = 10; // peak at 14:00
    const days = Array(7).fill(0) as number[];
    days[3] = 5;    // peak on Wednesday (3)
    expect(isTimingMatch(hours, days, 0, 14, 3)).toBe(true);
  });

  it("returns true when current hour is within ±1 of peak", () => {
    const hours = Array(24).fill(0) as number[];
    hours[14] = 10;
    const days = Array(7).fill(0) as number[];
    days[3] = 5;
    expect(isTimingMatch(hours, days, 0, 13, 3)).toBe(true);
    expect(isTimingMatch(hours, days, 0, 15, 3)).toBe(true);
  });

  it("returns false when current hour is 2+ hours away from peak", () => {
    const hours = Array(24).fill(0) as number[];
    hours[14] = 10;
    const days = Array(7).fill(0) as number[];
    days[3] = 5;
    expect(isTimingMatch(hours, days, 0, 11, 3)).toBe(false);
  });

  it("returns false when day-of-week does not match, even if hour matches", () => {
    const hours = Array(24).fill(0) as number[];
    hours[14] = 10;
    const days = Array(7).fill(0) as number[];
    days[3] = 5; // Wednesday
    expect(isTimingMatch(hours, days, 0, 14, 2)).toBe(false); // Tuesday
  });

  it("handles midnight wrap-around: hour 23 and target 0 are within ±1", () => {
    const hours = Array(24).fill(0) as number[];
    hours[0] = 10; // target = midnight
    const days = Array(7).fill(0) as number[];
    days[0] = 5;
    expect(isTimingMatch(hours, days, 0, 23, 0)).toBe(true);  // 23:00 ≈ 00:00
    expect(isTimingMatch(hours, days, 0, 1, 0)).toBe(true);   // 01:00 ≈ 00:00
    expect(isTimingMatch(hours, days, 0, 2, 0)).toBe(false);  // 02:00 too far
  });

  it("uses secondary peak for sendIndex 1", () => {
    const hours = Array(24).fill(0) as number[];
    hours[9]  = 10; // primary
    hours[18] = 7;  // secondary
    const days = Array(7).fill(0) as number[];
    days[0] = 8; // primary (Sunday)
    days[4] = 5; // secondary (Thursday)
    expect(isTimingMatch(hours, days, 1, 18, 4)).toBe(true);   // secondary peak
    expect(isTimingMatch(hours, days, 1, 9, 0)).toBe(false);   // primary peak, wrong for sendIndex 1
  });
});
