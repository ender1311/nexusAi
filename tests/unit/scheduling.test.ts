import { describe, expect, it } from "bun:test";
import { getTodayStartUTC } from "@/lib/engine/scheduling";

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
