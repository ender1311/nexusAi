import type { SegmentRule, RuleNode, Condition } from "@/types/segment";
import { getField } from "./field-catalog";

export type CompiledWhere = { sql: string; params: unknown[] };

const SCALAR_OPS: Record<string, string> = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
};

class ParamBag {
  params: unknown[] = [];
  add(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

function leftExpr(c: Condition): { expr: string; isAttr: boolean; attrKey?: string } {
  // The parser guarantees the field exists, but guard here too: this is the only
  // place catalog identifiers enter the SQL string, so a forged rule that skipped
  // the parser must never reach the column/key interpolation below.
  const field = getField(c.fieldId);
  if (!field) throw new Error(`Unknown segment field: ${c.fieldId}`);
  const compile = field.compile;
  switch (compile.strategy) {
    case "scalar":
      return { expr: `u."${compile.column}"`, isAttr: false };
    case "attr": {
      const base = `u."attributes"->>'${compile.key}'`;
      const expr = compile.cast === "numeric" ? `(${base})::numeric`
        : compile.cast === "boolean" ? `(${base})::boolean`
        : base;
      return { expr, isAttr: true, attrKey: compile.key };
    }
    case "channelStat":
      return { expr: `(u."channelStats"->'${compile.channel}'->>'${compile.metric}')::numeric`, isAttr: false };
    case "segment":
      return { expr: "", isAttr: false };
  }
}

function compileCondition(c: Condition, bag: ParamBag): string {
  const { expr, isAttr, attrKey } = leftExpr(c);
  switch (c.operator) {
    case "eq": case "neq": case "gt": case "gte": case "lt": case "lte":
      return `${expr} ${SCALAR_OPS[c.operator]} ${bag.add(c.value)}`;
    case "in":
      return `${expr} = ANY(${bag.add(c.value)})`;
    case "nin":
      return `${expr} <> ALL(${bag.add(c.value)})`;
    case "contains":
      return `${expr} ILIKE ${bag.add(`%${String(c.value)}%`)}`;
    case "exists":
      return isAttr ? `u."attributes" ? '${attrKey}'` : `${expr} IS NOT NULL`;
    case "nexists":
      return isAttr ? `NOT (u."attributes" ? '${attrKey}')` : `${expr} IS NULL`;
    case "is_true":
      return `${expr} = true`;
    case "is_false":
      return `${expr} = false`;
    case "in_segment":
      return `EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" = u."externalId" AND us."segmentName" = ${bag.add(c.value)})`;
    case "not_in_segment":
      return `NOT EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" = u."externalId" AND us."segmentName" = ${bag.add(c.value)})`;
    default: {
      const _exhaustive: never = c.operator;
      throw new Error(`Unhandled segment operator: ${String(_exhaustive)}`);
    }
  }
}

// Independent of the parser's MAX_RULE_DEPTH (10); a forged rule that skipped the
// parser must not be able to drive unbounded recursion here. Headroom above 10.
const MAX_COMPILE_DEPTH = 20;

function compileNode(node: RuleNode, bag: ParamBag, depth = 0): string {
  if (depth > MAX_COMPILE_DEPTH) {
    throw new Error(`Segment rule nesting exceeds ${MAX_COMPILE_DEPTH} levels`);
  }
  if (node.kind === "condition") return compileCondition(node, bag);
  // `join` is the only group field spliced verbatim into SQL; whitelist it so a
  // forged rule that bypassed the parser can't inject through the join keyword.
  if (node.join !== "AND" && node.join !== "OR") {
    throw new Error(`Illegal segment join: ${String(node.join)}`);
  }
  const parts = node.children.map((child) => compileNode(child, bag, depth + 1)).filter((s) => s !== "");
  if (parts.length === 0) return "";
  return `(${parts.join(` ${node.join} `)})`;
}

export function compileSegmentRule(rule: SegmentRule): CompiledWhere {
  const bag = new ParamBag();
  const sql = compileNode(rule, bag);
  return { sql: sql === "" ? "TRUE" : sql, params: bag.params };
}
