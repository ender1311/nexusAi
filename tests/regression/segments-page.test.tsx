import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentBuilder } from "@/components/segments/segment-builder";

describe("Audience › Segments builder", () => {
  it("renders the builder shell, not the Coming soon placeholder", () => {
    const html = renderToStaticMarkup(
      <SegmentBuilder segments={[]} personaOptions={[]} segmentNameOptions={[]} facetMap={{}} />
    );
    expect(html).toContain("New segment");
    expect(html).not.toContain("Coming soon");
  });

  it("renders existing saved segments in the list", () => {
    const html = renderToStaticMarkup(
      <SegmentBuilder
        segments={[{ id: "s1", name: "WAU power users", description: null, updatedAt: new Date().toISOString() }]}
        personaOptions={[]}
        segmentNameOptions={[]}
        facetMap={{}}
      />
    );
    expect(html).toContain("WAU power users");
  });
});
