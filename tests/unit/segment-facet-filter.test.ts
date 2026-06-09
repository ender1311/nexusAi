import { describe, expect, it } from "bun:test";
import { filterFacetValues } from "@/lib/segments/facet-filter";

const values = [
  { value: "US", count: 174018 },
  { value: "GB", count: 50000 },
  { value: "DE", count: 9000 },
];

describe("filterFacetValues", () => {
  it("returns the full list (count-desc) for an empty query", () => {
    expect(filterFacetValues(values, "", "country_latest")).toEqual(values);
  });

  it("matches on the raw value, case-insensitively", () => {
    expect(filterFacetValues(values, "gb", "country_latest").map((v) => v.value)).toEqual(["GB"]);
  });

  it("matches on the friendly name", () => {
    expect(filterFacetValues(values, "united", "country_latest").map((v) => v.value)).toEqual(["US", "GB"]);
  });

  it("preserves count-desc order in matches", () => {
    expect(filterFacetValues(values, "united", "country_latest").map((v) => v.count)).toEqual([174018, 50000]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterFacetValues(values, "zzz", "country_latest")).toEqual([]);
  });
});
