// tests/unit/votd-local-date.test.ts
import { describe, it, expect } from "bun:test";
import { userLocalDate } from "@/lib/votd/local-date";

describe("userLocalDate", () => {
  const at = new Date("2026-06-11T03:00:00Z");
  it("renders the calendar date in the user's timezone", () => {
    expect(userLocalDate("America/Chicago", at)).toBe("2026-06-10"); // 22:00 Jun 10 CDT
    expect(userLocalDate("Asia/Tokyo", at)).toBe("2026-06-11");      // 12:00 Jun 11 JST
  });
  it("falls back to America/Chicago for null/undefined/blank", () => {
    expect(userLocalDate(null, at)).toBe("2026-06-10");
    expect(userLocalDate(undefined, at)).toBe("2026-06-10");
    expect(userLocalDate("  ", at)).toBe("2026-06-10");
  });
  it("falls back to America/Chicago for an invalid timezone string", () => {
    expect(userLocalDate("Not/AZone", at)).toBe("2026-06-10");
  });
});
