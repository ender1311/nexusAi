import { describe, it, expect } from "bun:test";
import {
  DEFAULT_DOLLARS_TO_BIBLES,
  parseMultiplier,
  computeBibles,
  substituteGivingCopy,
} from "@/lib/engine/giving-copy";

describe("parseMultiplier", () => {
  it("parses a positive numeric string", () => {
    expect(parseMultiplier("30")).toBe(30);
  });
  it("falls back to default on blank", () => {
    expect(parseMultiplier("")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
    expect(parseMultiplier(null)).toBe(DEFAULT_DOLLARS_TO_BIBLES);
    expect(parseMultiplier(undefined)).toBe(DEFAULT_DOLLARS_TO_BIBLES);
  });
  it("falls back to default on garbage", () => {
    expect(parseMultiplier("abc")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
  });
  it("falls back to default on zero or negative", () => {
    expect(parseMultiplier("0")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
    expect(parseMultiplier("-5")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
  });
  it("accepts a fractional multiplier", () => {
    expect(parseMultiplier("24.5")).toBe(24.5);
  });
});

describe("computeBibles", () => {
  it("multiplies USD amount by the multiplier and rounds", () => {
    expect(computeBibles(25, 24)).toBe(600);
  });
  it("rounds to the nearest integer", () => {
    expect(computeBibles(25, 24.4)).toBe(610);
  });
  it("guards non-finite or non-positive amounts to 0", () => {
    expect(computeBibles(0, 24)).toBe(0);
    expect(computeBibles(-5, 24)).toBe(0);
    expect(computeBibles(Number.NaN, 24)).toBe(0);
  });
});

describe("substituteGivingCopy", () => {
  it("replaces {{ask}} and {{bibles}} (bibles with thousands separators)", () => {
    const out = substituteGivingCopy(
      "A gift of {{ask}} a month will distribute over {{bibles}} Bible apps this year",
      { amountDisplay: "$25", bibles: 600 },
    );
    expect(out).toBe("A gift of $25 a month will distribute over 600 Bible apps this year");
  });
  it("formats large bibles counts with separators", () => {
    const out = substituteGivingCopy("{{bibles}}", { amountDisplay: "$100", bibles: 2400 });
    expect(out).toBe("2,400");
  });
  it("replaces all occurrences of a token", () => {
    expect(substituteGivingCopy("{{ask}} {{ask}}", { amountDisplay: "$10", bibles: 240 })).toBe("$10 $10");
  });
  it("leaves unknown tokens untouched", () => {
    expect(substituteGivingCopy("{{ask}} {{unknown}}", { amountDisplay: "$10", bibles: 240 }))
      .toBe("$10 {{unknown}}");
  });
  it("passes text with no placeholders through unchanged", () => {
    expect(substituteGivingCopy("plain text", { amountDisplay: "$10", bibles: 240 })).toBe("plain text");
  });

  // Follow-up #6 — locale-aware number formatting
  it("formats {{bibles}} with German period thousands separator for 'de' locale", () => {
    // German uses periods for thousands: 1.234 instead of 1,234
    const out = substituteGivingCopy("{{bibles}}", { amountDisplay: "25 €", bibles: 1234 }, "de");
    // The exact separator is locale-dependent; assert it differs from en-US "1,234"
    expect(out).not.toBe("1,234");
    expect(out).toContain("1");
    expect(out).toContain("234");
  });
  it("formats {{bibles}} with Spanish locale (es) — differs from en-US for 4-digit numbers", () => {
    // Spanish (es) uses period as thousands separator: 1.234
    const out = substituteGivingCopy("{{bibles}}", { amountDisplay: "25 €", bibles: 1234 }, "es");
    expect(out).not.toBe("1,234");
  });
  it("falls back to en-US formatting when locale is null", () => {
    const out = substituteGivingCopy("{{bibles}}", { amountDisplay: "$25", bibles: 2400 }, null);
    expect(out).toBe("2,400");
  });
  it("falls back to en-US formatting when locale is undefined", () => {
    const out = substituteGivingCopy("{{bibles}}", { amountDisplay: "$25", bibles: 2400 });
    expect(out).toBe("2,400");
  });
  it("normalises underscore tag (es_MX → es-MX) without throwing", () => {
    // Should not throw; Spanish-Mexico uses period thousands separator
    expect(() =>
      substituteGivingCopy("{{bibles}}", { amountDisplay: "$25", bibles: 1234 }, "es_MX")
    ).not.toThrow();
  });
});
