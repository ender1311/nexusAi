import { describe, expect, it } from "bun:test";
import { formatFacetValueLabel, formatRangeHint } from "@/lib/segments/facet-labels";

describe("formatFacetValueLabel", () => {
  it("annotates a mapped country code with its name + count", () => {
    expect(formatFacetValueLabel("country_latest", "US", 174018)).toBe("US · United States — 174,018");
  });

  it("annotates a mapped language tag", () => {
    expect(formatFacetValueLabel("language_tag", "en", 5000)).toBe("en · English — 5,000");
  });

  it("falls back to raw value + count for an unmapped country code", () => {
    expect(formatFacetValueLabel("country_latest", "ZZ", 3)).toBe("ZZ — 3");
  });

  it("shows just value + count for a non-country/language field", () => {
    expect(formatFacetValueLabel("preferred_channel_overall_30_days", "push_notification", 42)).toBe("push_notification — 42");
  });
});

describe("formatRangeHint", () => {
  it("formats a numeric range with median", () => {
    expect(formatRangeHint("number", { min: 0, max: 365, p50: 12, p90: 200 })).toBe("In data: 0–365 · median 12");
  });

  it("formats a date range using calendar dates", () => {
    const hint = formatRangeHint("date", { min: "2024-01-01T00:00:00.000Z", max: "2026-06-01T00:00:00.000Z", p50: "2025-03-15T00:00:00.000Z", p90: "2026-01-01T00:00:00.000Z" });
    expect(hint).toBe("In data: 2024-01-01–2026-06-01 · median 2025-03-15");
  });
});
