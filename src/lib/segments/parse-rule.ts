import type { RuleNode, SegmentRule, Operator, ConditionValue } from "@/types/segment";
import { getField, isOperatorLegal } from "./field-catalog";

export const MAX_RULE_DEPTH = 10;

function parseNode(value: unknown, depth: number): RuleNode | null {
  if (depth > MAX_RULE_DEPTH) return null;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (v.kind === "group") {
    if (v.join !== "AND" && v.join !== "OR") return null;
    if (!Array.isArray(v.children)) return null;
    const children: RuleNode[] = [];
    for (const child of v.children) {
      const parsed = parseNode(child, depth + 1);
      if (parsed === null) return null;
      children.push(parsed);
    }
    return { kind: "group", join: v.join, children };
  }

  if (v.kind === "condition") {
    if (typeof v.fieldId !== "string") return null;
    const field = getField(v.fieldId);
    if (!field) return null;
    if (typeof v.operator !== "string" || !isOperatorLegal(field, v.operator as Operator)) return null;
    return {
      kind: "condition",
      fieldId: v.fieldId,
      operator: v.operator as Operator,
      value: (v.value ?? null) as ConditionValue,
    };
  }

  return null;
}

export function parseSegmentRule(value: unknown): SegmentRule | null {
  const node = parseNode(value, 0);
  if (node === null || node.kind !== "group") return null;
  return node;
}
