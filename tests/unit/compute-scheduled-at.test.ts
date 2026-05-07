import { describe, expect, it } from "bun:test";
import { computeScheduledAt } from "@/lib/engine/scheduling";

// Fixed "now" for deterministic tests: 2026-05-07T14:00:00Z (10:00 AM ET)
const NOW = new Date("2026-05-07T14:00:00Z");

describe("computeScheduledAt", () => {
  it("uses preferred hour when the computed time (minus 10 min) is in the future", () => {
    // preferred: 16:00 UTC → candidate = 15:50 UTC → future (now is 14:00) → use it
    const result = computeScheduledAt(16, 0, 8, NOW);
    expect(result.scheduledAt).toEqual(new Date("2026-05-07T15:50:00Z"));
    expect(result.inLocalTime).toBe(false);
  });

  it("uses preferred hour with non-zero minutes, subtracts 10 min correctly", () => {
    // preferred: 15:30 UTC → candidate = 15:20 UTC → future → use it
    const result = computeScheduledAt(15, 30, 8, NOW);
    expect(result.scheduledAt).toEqual(new Date("2026-05-07T15:20:00Z"));
    expect(result.inLocalTime).toBe(false);
  });

  it("handles 10-minute subtraction crossing an hour boundary", () => {
    // preferred: 15:05 UTC → totalMinutes = 15*60+5-10 = 895 → 14:55 UTC → future → use it
    const result = computeScheduledAt(15, 5, 8, NOW);
    expect(result.scheduledAt).toEqual(new Date("2026-05-07T14:55:00Z"));
    expect(result.inLocalTime).toBe(false);
  });

  it("falls back to fallback hour when preferred time has already passed", () => {
    // preferred: 12:00 UTC → candidate = 11:50 UTC → past (now is 14:00) → fallback
    // fallbackSendHour = 8 → 08:00 UTC today is past → roll to tomorrow
    const result = computeScheduledAt(12, 0, 8, NOW);
    expect(result.scheduledAt).toEqual(new Date("2026-05-08T08:00:00Z"));
    expect(result.inLocalTime).toBe(true);
  });

  it("uses null preferred hour → always falls back", () => {
    // No preferred hour, fallbackSendHour = 20 UTC → 20:00 today is future (now is 14:00)
    const result = computeScheduledAt(null, null, 20, NOW);
    expect(result.scheduledAt).toEqual(new Date("2026-05-07T20:00:00Z"));
    expect(result.inLocalTime).toBe(true);
  });

  it("rolls fallback to tomorrow when fallback hour has already passed today", () => {
    // fallbackSendHour = 10 UTC, now is 14:00 UTC → 10:00 today is past → roll to tomorrow
    const result = computeScheduledAt(null, null, 10, NOW);
    expect(result.scheduledAt).toEqual(new Date("2026-05-08T10:00:00Z"));
    expect(result.inLocalTime).toBe(true);
  });

  it("handles preferred hour at midnight (0) with subtraction crossing into negative minutes", () => {
    // preferred: 00:05 UTC → totalMinutes = 0*60+5-10 = -5 → offsetHour = floor(-5/60) = -1 → 23:55 UTC prev day
    // candidate = 2026-05-06T23:55:00Z → past (now is May 7 14:00) → falls back
    const result = computeScheduledAt(0, 5, 8, NOW);
    // Expected: fallback to tomorrow since candidate is in the past
    expect(result.inLocalTime).toBe(true);
    expect(result.scheduledAt).toEqual(new Date("2026-05-08T08:00:00Z"));
  });

  it("returns inLocalTime false only when using the preferred hour path", () => {
    const future = computeScheduledAt(18, 0, 8, NOW);
    expect(future.inLocalTime).toBe(false);

    const fallback = computeScheduledAt(null, null, 18, NOW);
    expect(fallback.inLocalTime).toBe(true);
  });
});
