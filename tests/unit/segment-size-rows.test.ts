import { describe, expect, it } from "bun:test";
import { mergeSegmentSizeRows, bestSize, type RuleSegInput, type HtSegInput } from "@/lib/segments/size-rows";

const baseRule = (over: Partial<RuleSegInput>): RuleSegInput => ({
  id: "s1", name: "Rule A", description: null, estimate: 100,
  sizeExact: null, sizeComputedAt: null, updatedAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

describe("mergeSegmentSizeRows", () => {
  it("tags each source with its kind and serializes dates to ISO strings", () => {
    const rows = mergeSegmentSizeRows(
      [baseRule({ sizeComputedAt: new Date("2026-06-02T03:04:05Z") })],
      [{ name: "ht-seg", userCount: 5, assignedTo: "Agent X" }],
    );
    const rule = rows.find((r) => r.kind === "rule")!;
    const ht = rows.find((r) => r.kind === "hightouch")!;
    expect(rule.kind).toBe("rule");
    expect(ht.kind).toBe("hightouch");
    if (rule.kind === "rule") {
      expect(rule.sizeComputedAt).toBe("2026-06-02T03:04:05.000Z");
      expect(rule.updatedAt).toBe("2026-06-01T00:00:00.000Z");
    }
  });

  it("prefers exact over estimate as the sort key, descending", () => {
    const rows = mergeSegmentSizeRows(
      [
        baseRule({ id: "small", name: "Small", estimate: 10, sizeExact: 10 }),
        baseRule({ id: "bigexact", name: "BigExact", estimate: 50, sizeExact: 9000 }),
      ],
      [{ name: "ht-mid", userCount: 1000, assignedTo: null }],
    );
    expect(rows.map((r) => r.name)).toEqual(["BigExact", "ht-mid", "Small"]);
  });

  it("falls back to estimate when sizeExact is null", () => {
    const row = mergeSegmentSizeRows([baseRule({ estimate: 777, sizeExact: null })], [])[0];
    expect(bestSize(row)).toBe(777);
  });

  it("sorts a rule with both sizes null (invalid rule) last", () => {
    const rows = mergeSegmentSizeRows(
      [
        baseRule({ id: "invalid", name: "Invalid", estimate: null, sizeExact: null }),
        baseRule({ id: "ok", name: "Ok", estimate: 5, sizeExact: null }),
      ],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(["Ok", "Invalid"]);
  });
});
