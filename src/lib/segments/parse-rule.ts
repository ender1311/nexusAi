import type { RuleNode, SegmentRule, Operator, ConditionValue } from "@/types/segment";
import { getField, isOperatorLegal } from "./field-catalog";

export const MAX_RULE_DEPTH = 10;

const ARRAY_OPS: Operator[] = ["in", "nin"];
const SEGMENT_OPS: Operator[] = ["in_segment", "not_in_segment"];
const VALUELESS_OPS: Operator[] = ["exists", "nexists", "is_true", "is_false"];

// Reject operator/value-shape mismatches at the parse boundary so a malformed rule
// becomes a 400, not a Postgres 500 (e.g. `in` with a scalar → `= ANY($1)` on a
// non-array). Returns the value to store, or undefined to reject the whole node.
function coerceValue(operator: Operator, raw: unknown): ConditionValue | undefined {
  if (VALUELESS_OPS.includes(operator)) return null;
  if (ARRAY_OPS.includes(operator)) {
    if (!Array.isArray(raw)) return undefined;
    if (!raw.every((e) => typeof e === "string" || typeof e === "number")) return undefined;
    return raw as string[];
  }
  if (SEGMENT_OPS.includes(operator)) {
    return typeof raw === "string" ? raw : undefined;
  }
  // Scalar comparison + contains: a single primitive, never an array or null.
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  return undefined;
}

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
    const operator = v.operator as Operator;
    const value = coerceValue(operator, v.value ?? null);
    if (value === undefined) return null;
    return { kind: "condition", fieldId: v.fieldId, operator, value };
  }

  return null;
}

export function parseSegmentRule(value: unknown): SegmentRule | null {
  const node = parseNode(value, 0);
  if (node === null || node.kind !== "group") return null;
  return node;
}
