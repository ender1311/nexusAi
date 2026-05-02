import { describe, expect, it } from "bun:test";
import { computeSendTime } from "@/lib/engine/send-timing";

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
