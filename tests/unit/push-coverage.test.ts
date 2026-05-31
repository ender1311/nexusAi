import { describe, it, expect } from "bun:test";
import { countCoverageLanguages, formatLanguageCoverage } from "@/lib/push-coverage";

describe("countCoverageLanguages", () => {
  it("counts distinct non-English languages", () => {
    expect(countCoverageLanguages(["es", "pt", "fr"])).toBe(3);
  });
  it("ignores en/EN and blanks, and dedupes", () => {
    expect(countCoverageLanguages(["es", "es", "en", "EN", "  "])).toBe(1);
  });
  it("returns 0 for an empty list", () => {
    expect(countCoverageLanguages([])).toBe(0);
  });
});

describe("formatLanguageCoverage", () => {
  it("reports EN only when there are no translations", () => {
    expect(formatLanguageCoverage([])).toBe("EN only");
    expect(formatLanguageCoverage(["en"])).toBe("EN only");
  });
  it("uses the singular for exactly one language", () => {
    expect(formatLanguageCoverage(["es"])).toBe("EN + 1 language");
  });
  it("uses the plural for many languages", () => {
    expect(formatLanguageCoverage(["es", "pt", "zh_TW"])).toBe("EN + 3 languages");
  });
});
