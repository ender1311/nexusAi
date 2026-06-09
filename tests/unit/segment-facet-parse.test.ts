import { describe, expect, it } from "bun:test";
import { parseFacetPayload, buildFacetMap } from "@/lib/segments/facet-types";

describe("parseFacetPayload", () => {
  it("parses a values payload", () => {
    const f = parseFacetPayload("values", { top: [{ value: "US", count: 10 }], distinctApprox: 3, total: 12 });
    expect(f).toEqual({ kind: "values", payload: { top: [{ value: "US", count: 10 }], distinctApprox: 3, total: 12 } });
  });

  it("parses a range payload", () => {
    const f = parseFacetPayload("range", { min: 0, max: 365, p50: 12, p90: 200 });
    expect(f).toEqual({ kind: "range", payload: { min: 0, max: 365, p50: 12, p90: 200 } });
  });

  it("returns null for an unknown kind", () => {
    expect(parseFacetPayload("bogus", {})).toBeNull();
  });

  it("returns null for a corrupt values payload (top not an array)", () => {
    expect(parseFacetPayload("values", { top: "nope", distinctApprox: 1, total: 1 })).toBeNull();
  });

  it("drops corrupt entries inside top but keeps valid ones", () => {
    const f = parseFacetPayload("values", { top: [{ value: "US", count: 10 }, { value: 5, count: "x" }], distinctApprox: 1, total: 11 });
    expect(f).toEqual({ kind: "values", payload: { top: [{ value: "US", count: 10 }], distinctApprox: 1, total: 11 } });
  });

  it("buildFacetMap skips rows that fail to parse", () => {
    const map = buildFacetMap([
      { fieldId: "country_latest", kind: "values", payload: { top: [{ value: "US", count: 9 }], distinctApprox: 1, total: 9 } },
      { fieldId: "broken", kind: "values", payload: { top: 42 } },
    ]);
    expect(Object.keys(map)).toEqual(["country_latest"]);
    expect(map.country_latest!.kind).toBe("values");
  });
});
