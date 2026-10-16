import { describe, expect, it } from "bun:test";
import { parseDemoParams, toSearch } from "@site/lib/demo/url-state";

describe("demo url state", () => {
  it("parses valid params", () => {
    expect(parseDemoParams(new URLSearchParams("step=5&source=braze-catalog"))).toEqual({ step: 5, source: "braze-catalog" });
  });
  it("clamps bad steps and falls back on unknown sources", () => {
    expect(parseDemoParams(new URLSearchParams("step=9&source=foo"))).toEqual({ step: 6, source: "contentful" });
    expect(parseDemoParams(new URLSearchParams("step=-2"))).toEqual({ step: 1, source: "contentful" });
    expect(parseDemoParams(new URLSearchParams("step=abc"))).toEqual({ step: 1, source: "contentful" });
  });
  it("round-trips", () => {
    expect(parseDemoParams(new URLSearchParams(toSearch(3, "sanity")))).toEqual({ step: 3, source: "sanity" });
  });
});
