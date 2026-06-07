import { describe, expect, it } from "bun:test";
import { parseSegmentRule, MAX_RULE_DEPTH } from "@/lib/segments/parse-rule";

const cond = (fieldId: string, operator: string, value: unknown) => ({ kind: "condition", fieldId, operator, value });
const group = (join: string, children: unknown[]) => ({ kind: "group", join, children });

describe("parseSegmentRule", () => {
  it("accepts a valid nested tree", () => {
    const tree = group("AND", [cond("funnelStage", "in", ["wau"]), group("OR", [cond("totalDecisions", "gte", 5)])]);
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
    let node: unknown = cond("totalDecisions", "gte", 1);
    for (let i = 0; i <= MAX_RULE_DEPTH + 1; i++) node = group("AND", [node]);
    expect(parseSegmentRule(node)).toBeNull();
  });
});
