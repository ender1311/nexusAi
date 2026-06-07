import { describe, expect, it } from "bun:test";
import { addChild, removeAt, updateConditionAt, setJoinAt, emptyRule } from "@/lib/segments/rule-tree-ops";
import type { SegmentRule, Condition } from "@/types/segment";

const cond = (fieldId: string): Condition => ({ kind: "condition", fieldId, operator: "exists", value: null });

describe("rule-tree-ops (pure)", () => {
  it("emptyRule is an empty AND group", () => {
    expect(emptyRule()).toEqual({ kind: "group", join: "AND", children: [] });
  });

  it("addChild appends to the root and does not mutate the input", () => {
    const root = emptyRule();
    const next = addChild(root, [], cond("email"));
    expect(next.children.length).toBe(1);
    expect(root.children.length).toBe(0); // immutability
  });

  it("addChild appends to a nested group by path", () => {
    let root: SegmentRule = addChild(emptyRule(), [], { kind: "group", join: "OR", children: [] });
    root = addChild(root, [0], cond("email"));
    const nested = root.children[0];
    expect(nested.kind).toBe("group");
    if (nested.kind === "group") expect(nested.children.length).toBe(1);
  });

  it("removeAt removes a child by path", () => {
    let root = addChild(emptyRule(), [], cond("email"));
    root = addChild(root, [], cond("timezone"));
    const next = removeAt(root, [0]);
    expect(next.children.length).toBe(1);
    expect((next.children[0] as Condition).fieldId).toBe("timezone");
  });

  it("updateConditionAt replaces a condition by path", () => {
    const root = addChild(emptyRule(), [], cond("email"));
    const next = updateConditionAt(root, [0], { kind: "condition", fieldId: "timezone", operator: "eq", value: "UTC" });
    expect((next.children[0] as Condition).fieldId).toBe("timezone");
  });

  it("setJoinAt flips a group's join", () => {
    const next = setJoinAt(emptyRule(), [], "OR");
    expect(next.join).toBe("OR");
  });
});
