"use client";

import { Trash2, Plus } from "lucide-react";
import type { RuleNode, Condition, Operator } from "@/types/segment";
import { FIELD_CATALOG, getField } from "@/lib/segments/field-catalog";

export type EditorContext = {
  personaOptions: { value: string; label: string }[];
  segmentNameOptions: string[];
  onAddCondition: (path: number[]) => void;
  onAddGroup: (path: number[]) => void;
  onRemove: (path: number[]) => void;
  onChangeCondition: (path: number[], next: Condition) => void;
  onToggleJoin: (path: number[], join: "AND" | "OR") => void;
};

const VALUELESS_OPS: Operator[] = ["exists", "nexists", "is_true", "is_false"];
const MULTI_OPS: Operator[] = ["in", "nin"];

function operatorLabel(op: Operator): string {
  const map: Record<Operator, string> = {
    eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
    in: "is any of", nin: "is none of", contains: "contains",
    exists: "exists", nexists: "is missing", is_true: "is true", is_false: "is false",
    in_segment: "is in segment", not_in_segment: "is not in segment",
  };
  return map[op];
}

// Reset the value when the operator changes so a stale scalar/array never lingers
// under an incompatible operator (e.g. switching eq → in, or → a valueless op).
function defaultValueForOperator(op: Operator): Condition["value"] {
  if (VALUELESS_OPS.includes(op)) return null;
  if (MULTI_OPS.includes(op)) return [];
  return null;
}

function ValueEditor({ node, path, ctx }: { node: Condition; path: number[]; ctx: EditorContext }) {
  const field = getField(node.fieldId);
  if (field === undefined || VALUELESS_OPS.includes(node.operator)) return null;

  const selectClass = "rounded border bg-background px-2 py-1 text-sm";

  // Single segment picker (in_segment / not_in_segment).
  if (field.category === "segment") {
    return (
      <select
        className={selectClass}
        value={typeof node.value === "string" ? node.value : ""}
        onChange={(e) => ctx.onChangeCondition(path, { ...node, value: e.target.value })}
        aria-label="Segment"
      >
        <option value="">Select segment…</option>
        {ctx.segmentNameOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    );
  }

  // Enum fields (funnel stage from the catalog, persona from props) — multi-select.
  const enumOptions = field.enumValues ?? (field.id === "persona" ? ctx.personaOptions : undefined);
  if (enumOptions !== undefined) {
    const selected = Array.isArray(node.value) ? node.value.map(String) : [];
    return (
      <select
        multiple
        className={`${selectClass} min-h-16`}
        value={selected}
        onChange={(e) => {
          const next = Array.from(e.target.selectedOptions).map((o) => o.value);
          ctx.onChangeCondition(path, { ...node, value: next });
        }}
        aria-label="Values"
      >
        {enumOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  // Free-text for string/number/date fields.
  const isMulti = MULTI_OPS.includes(node.operator);
  return (
    <input
      className={selectClass}
      value={node.value === null ? "" : Array.isArray(node.value) ? node.value.join(",") : String(node.value)}
      placeholder={isMulti ? "comma,separated" : "value"}
      onChange={(e) => {
        const raw = e.target.value;
        let value: Condition["value"];
        if (isMulti) {
          value = raw.split(",").map((s) => s.trim()).filter(Boolean);
        } else if (field.type === "number") {
          const n = Number(raw);
          value = raw.trim() === "" || Number.isNaN(n) ? null : n;
        } else {
          value = raw;
        }
        ctx.onChangeCondition(path, { ...node, value });
      }}
    />
  );
}

function ConditionRow({ node, path, ctx }: { node: Condition; path: number[]; ctx: EditorContext }) {
  const field = getField(node.fieldId);

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={node.fieldId}
        onChange={(e) => {
          const f = getField(e.target.value);
          if (f === undefined) return;
          ctx.onChangeCondition(path, { kind: "condition", fieldId: f.id, operator: f.operators[0], value: defaultValueForOperator(f.operators[0]) });
        }}
      >
        {FIELD_CATALOG.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>

      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={node.operator}
        onChange={(e) => {
          const nextOp = e.target.value as Operator;
          ctx.onChangeCondition(path, { ...node, operator: nextOp, value: defaultValueForOperator(nextOp) });
        }}
      >
        {(field?.operators ?? []).map((op) => (
          <option key={op} value={op}>{operatorLabel(op)}</option>
        ))}
      </select>

      <ValueEditor node={node} path={path} ctx={ctx} />

      <button onClick={() => ctx.onRemove(path)} className="text-muted-foreground hover:text-destructive" aria-label="Remove condition">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function RuleNodeEditor({ node, path, ctx }: { node: RuleNode; path: number[]; ctx: EditorContext }) {
  if (node.kind === "condition") return <ConditionRow node={node} path={path} ctx={ctx} />;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded border overflow-hidden text-xs">
          {(["AND", "OR"] as const).map((j) => (
            <button
              key={j}
              onClick={() => ctx.onToggleJoin(path, j)}
              className={`px-2 py-0.5 ${node.join === j ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {j}
            </button>
          ))}
        </div>
        {path.length > 0 && (
          <button onClick={() => ctx.onRemove(path)} className="text-muted-foreground hover:text-destructive" aria-label="Remove group">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="pl-3 border-l space-y-1">
        {node.children.map((child, i) => (
          <RuleNodeEditor key={i} node={child} path={[...path, i]} ctx={ctx} />
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={() => ctx.onAddCondition(path)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" /> Condition
        </button>
        <button onClick={() => ctx.onAddGroup(path)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" /> Group
        </button>
      </div>
    </div>
  );
}
