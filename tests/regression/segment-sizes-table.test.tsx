// Regression: the sizes table renders the right size affordance per row kind/state,
// and exposes Refresh controls only on rule rows.
// See docs/superpowers/specs/2026-06-07-segments-sizes-c2-design.md (Unified table).
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentSizesTable } from "@/components/segments/segment-sizes-table";
import type { SizeRow } from "@/lib/segments/size-rows";

const rows: SizeRow[] = [
  { kind: "rule", id: "a", name: "Exact Rule", description: null, estimate: 50, sizeExact: 1234567, sizeComputedAt: "2026-06-06T00:00:00.000Z", updatedAt: "2026-06-06T00:00:00.000Z" },
  { kind: "rule", id: "b", name: "Estimate Rule", description: null, estimate: 4200, sizeExact: null, sizeComputedAt: null, updatedAt: "2026-06-06T00:00:00.000Z" },
  { kind: "rule", id: "c", name: "Invalid Rule", description: null, estimate: null, sizeExact: null, sizeComputedAt: null, updatedAt: "2026-06-06T00:00:00.000Z" },
  { kind: "hightouch", name: "ht-seg", userCount: 9000, assignedTo: "Agent X" },
];

describe("SegmentSizesTable", () => {
  it("shows the exact value for a rule row that has a cached exact count", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("1.2M"); // formatNumber(1234567)
    expect(html).toContain("Exact Rule");
  });

  it("shows an approximate marker for an estimate-only rule row", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("≈");
    expect(html).toContain("4.2K"); // formatNumber(4200)
  });

  it("shows an invalid-rule marker when both sizes are null", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("invalid rule");
  });

  it("renders Hightouch rows with their member count and a Hightouch badge", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("ht-seg");
    expect(html).toContain("9.0K"); // formatNumber(9000) → "9.0K"
    expect(html).toContain("Hightouch");
  });

  it("renders a Refresh all control when at least one rule row exists", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("Refresh all");
  });

  it("renders an empty state when there are no rows", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={[]} />);
    expect(html).toContain("No segments yet");
  });
});
