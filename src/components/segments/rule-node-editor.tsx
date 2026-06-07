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

function OPERATOR_LABEL(op: Operator): string {
  const map: Record<Operator, string> = {
    eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
    in: "is any of", nin: "is none of", contains: "contains",
    exists: "exists", nexists: "is missing", is_true: "is true", is_false: "is false",
    in_segment: "is in segment", not_in_segment: "is not in segment",
  };
  return map[op];
}

function ConditionRow({ node, path, ctx }: { node: Condition; path: number[]; ctx: EditorContext }) {
  const field = getField(node.fieldId);
  const valuelessOps: Operator[] = ["exists", "nexists", "is_true", "is_false"];
  const needsValue = !valuelessOps.includes(node.operator);

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={node.fieldId}
        onChange={(e) => {
          const f = getField(e.target.value)!;
          ctx.onChangeCondition(path, { kind: "condition", fieldId: f.id, operator: f.operators[0], value: null });
        }}
      >
        {FIELD_CATALOG.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>

      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={node.operator}
        onChange={(e) => ctx.onChangeCondition(path, { ...node, operator: e.target.value as Operator })}
      >
        {(field?.operators ?? []).map((op) => (
          <option key={op} value={op}>{OPERATOR_LABEL(op)}</option>
        ))}
      </select>

      {needsValue && (
        <input
          className="rounded border bg-background px-2 py-1 text-sm"
          value={node.value === null ? "" : Array.isArray(node.value) ? node.value.join(",") : String(node.value)}
          placeholder={node.operator === "in" || node.operator === "nin" ? "comma,separated" : "value"}
          onChange={(e) => {
            const raw = e.target.value;
            const value = node.operator === "in" || node.operator === "nin"
              ? raw.split(",").map((s) => s.trim()).filter(Boolean)
              : field?.type === "number" ? Number(raw)
              : raw;
            ctx.onChangeCondition(path, { ...node, value });
          }}
        />
      )}

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
