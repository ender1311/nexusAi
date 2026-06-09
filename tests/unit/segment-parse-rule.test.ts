import { describe, expect, it } from "bun:test";
import { parseSegmentRule, MAX_RULE_DEPTH } from "@/lib/segments/parse-rule";

const cond = (fieldId: string, operator: string, value: unknown) => ({ kind: "condition", fieldId, operator, value });
const group = (join: string, children: unknown[]) => ({ kind: "group", join, children });

describe("parseSegmentRule", () => {
  it("accepts a valid nested tree", () => {
    const tree = group("AND", [cond("funnelStage", "in", ["wau"]), group("OR", [cond("createdAt", "gte", 5)])]);
    const parsed = parseSegmentRule(tree);
    expect(parsed?.kind).toBe("group");
    expect(parsed?.children.length).toBe(2);
  });

  it("accepts an empty root group (matches all)", () => {
    expect(parseSegmentRule(group("AND", []))?.children.length).toBe(0);
  });

  it("rejects an unknown field → null", () => {
    expect(parseSegmentRule(group("AND", [cond("nope", "eq", 1)]))).toBeNull();
  });

  it("rejects an operator illegal for the field → null", () => {
    expect(parseSegmentRule(group("AND", [cond("funnelStage", "contains", "x")]))).toBeNull();
  });

  it("rejects a non-group root → null", () => {
    expect(parseSegmentRule(cond("funnelStage", "in", ["wau"]))).toBeNull();
  });

  it("rejects a bad join → null", () => {
    expect(parseSegmentRule(group("XOR", []))).toBeNull();
  });

  it("rejects malformed input → null", () => {
    expect(parseSegmentRule(null)).toBeNull();
    expect(parseSegmentRule("nope")).toBeNull();
    expect(parseSegmentRule({ kind: "group", join: "AND" })).toBeNull(); // no children array
  });

  it("rejects trees deeper than MAX_RULE_DEPTH → null", () => {
    let node: unknown = cond("createdAt", "gte", 1);
    for (let i = 0; i <= MAX_RULE_DEPTH + 1; i++) node = group("AND", [node]);
    expect(parseSegmentRule(node)).toBeNull();
  });

  // Operator/value-shape mismatches must be rejected at the parse boundary so they
  // become a 400, not a Postgres 500 (e.g. `in` with a scalar → `= ANY($1)` on a
  // non-array value). See Task 10 final review.
  it("rejects an array operator (in/nin) given a non-array value → null", () => {
    expect(parseSegmentRule(group("AND", [cond("funnelStage", "in", "wau")]))).toBeNull();
    expect(parseSegmentRule(group("AND", [cond("email", "nin", 5)]))).toBeNull();
  });

  it("rejects a scalar operator given an array value → null", () => {
    expect(parseSegmentRule(group("AND", [cond("createdAt", "gte", [1, 2])]))).toBeNull();
    expect(parseSegmentRule(group("AND", [cond("email", "eq", ["a", "b"])]))).toBeNull();
  });

  it("rejects a segment operator given a non-string value → null", () => {
    expect(parseSegmentRule(group("AND", [cond("segment_membership", "in_segment", ["x"])]))).toBeNull();
    expect(parseSegmentRule(group("AND", [cond("segment_membership", "in_segment", 7)]))).toBeNull();
  });

  it("normalizes valueless operators to a null value", () => {
    const parsed = parseSegmentRule(group("AND", [cond("has_recurring_gift", "is_true", "ignored")]));
    expect(parsed?.children[0]).toEqual({ kind: "condition", fieldId: "has_recurring_gift", operator: "is_true", value: null });
  });

  it("accepts a single segment name string for in_segment", () => {
    const parsed = parseSegmentRule(group("AND", [cond("segment_membership", "in_segment", "VIP donors")]));
    expect((parsed?.children[0] as { value: unknown }).value).toBe("VIP donors");
  });
});
