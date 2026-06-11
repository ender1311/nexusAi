// tests/unit/votd-content-helpers.test.ts
import { describe, it, expect } from "bun:test";
import { dayOfYear, renderImageUrl } from "@/lib/votd/votd-content";

describe("dayOfYear", () => {
  it("computes day of year in UTC", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-06-11")).toBe(162);
    expect(dayOfYear("2026-12-31")).toBe(365);
  });
  it("handles leap years", () => {
    expect(dayOfYear("2024-03-01")).toBe(61);
    expect(dayOfYear("2024-12-31")).toBe(366);
  });
});

describe("renderImageUrl", () => {
  it("replaces {w}/{h} placeholders", () => {
    expect(renderImageUrl("https://x/{w}x{h}/a.jpg", 320, 320)).toBe("https://x/320x320/a.jpg");
  });
  it("replaces {width}/{height} placeholders", () => {
    expect(renderImageUrl("https://x/{width}x{height}/a.jpg", 1024, 512)).toBe("https://x/1024x512/a.jpg");
  });
  it("prefixes https: on protocol-relative URLs", () => {
    expect(renderImageUrl("//imgs.youversion.com/{w}x{h}/a.jpg", 320, 320))
      .toBe("https://imgs.youversion.com/320x320/a.jpg");
  });
});
