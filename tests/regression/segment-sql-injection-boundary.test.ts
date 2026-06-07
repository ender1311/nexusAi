// Regression: segment values must be bound parameters, never inlined into SQL.
// Bug guard — a compiler change that interpolates user values would be a SQLi hole
// on the 10M-row "User" table. See docs/superpowers/specs/2026-06-07-segments-sizes-c1-design.md §4.
import { describe, expect, it } from "bun:test";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import type { SegmentRule } from "@/types/segment";

const rule = (children: unknown[]): SegmentRule => ({ kind: "group", join: "AND", children } as SegmentRule);

describe("segment SQL injection boundary", () => {
  it("a malicious value lands in params, never in the SQL string", () => {
    const evil = "x'; DROP TABLE \"User\"; --";
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "email", operator: "eq", value: evil },
    ]));
    expect(sql).not.toContain(evil);
    expect(sql).toContain("$1");
    expect(params).toEqual([evil]);
  });

  it("contains wraps the value (with wildcards) into params, not SQL", () => {
    const evil = "%' OR '1'='1";
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "email", operator: "contains", value: evil },
    ]));
    expect(sql).not.toContain(evil);
    expect(params).toEqual([`%${evil}%`]);
  });

  it("segment name value is a bound param", () => {
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "segment_membership", operator: "in_segment", value: "evil'; --" },
    ]));
    expect(sql).not.toContain("evil'; --");
    expect(params).toEqual(["evil'; --"]);
  });

  it("every placeholder index has a matching param", () => {
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] },
      { kind: "condition", fieldId: "totalDecisions", operator: "gte", value: 3 },
    ]));
    const placeholders = (sql.match(/\$\d+/g) ?? []).length;
    expect(placeholders).toBe(params.length);
  });
});
