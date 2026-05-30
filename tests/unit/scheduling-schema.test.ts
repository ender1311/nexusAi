import { describe, it, expect } from "bun:test";
import { parseQuietHours, parseFrequencyCap } from "@/lib/schemas/scheduling";

describe("parseQuietHours", () => {
  it("parses a full quiet-hours object", () => {
    const result = parseQuietHours({
      mode: "suppress",
      start: "22:00",
      end: "08:00",
      timezone: "America/New_York",
      quietDays: [0, 6],
    });
    expect(result).toEqual({
      mode: "suppress",
      start: "22:00",
      end: "08:00",
      timezone: "America/New_York",
      quietDays: [0, 6],
    });
  });

  it("parses the cron deliverAtHour variant", () => {
    const result = parseQuietHours({ mode: "schedule", timezone: "user", deliverAtHour: 9 });
    expect(result?.deliverAtHour).toBe(9);
  });

  it("strips unknown keys instead of failing", () => {
    const result = parseQuietHours({ start: "22:00", legacyField: "ignored" });
    expect(result).toEqual({ start: "22:00" });
  });

  it("returns null for non-object values", () => {
    expect(parseQuietHours(null)).toBeNull();
    expect(parseQuietHours(undefined)).toBeNull();
    expect(parseQuietHours("nope")).toBeNull();
    expect(parseQuietHours(42)).toBeNull();
  });
});

describe("parseFrequencyCap", () => {
  it("parses maxSends and period", () => {
    expect(parseFrequencyCap({ maxSends: 3, period: "week" })).toEqual({ maxSends: 3, period: "week" });
  });

  it("strips unknown keys", () => {
    expect(parseFrequencyCap({ maxSends: 1, extra: true })).toEqual({ maxSends: 1 });
  });

  it("returns null for non-object values", () => {
    expect(parseFrequencyCap(null)).toBeNull();
    expect(parseFrequencyCap(undefined)).toBeNull();
    expect(parseFrequencyCap("week")).toBeNull();
  });
});
