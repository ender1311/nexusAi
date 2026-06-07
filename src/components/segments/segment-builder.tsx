"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { SegmentRule, Condition } from "@/types/segment";
import { FIELD_CATALOG } from "@/lib/segments/field-catalog";
import { addChild, removeAt, updateConditionAt, setJoinAt, emptyRule } from "@/lib/segments/rule-tree-ops";
import { RuleNodeEditor, type EditorContext } from "./rule-node-editor";

export type SegmentSummary = { id: string; name: string; description: string | null; updatedAt: string };

type Props = {
  segments: SegmentSummary[];
  personaOptions: { value: string; label: string }[];
  segmentNameOptions: string[];
};

const firstCondition = (): Condition => ({ kind: "condition", fieldId: FIELD_CATALOG[0].id, operator: FIELD_CATALOG[0].operators[0], value: null });

export function SegmentBuilder({ segments, personaOptions, segmentNameOptions }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rule, setRule] = useState<SegmentRule>(emptyRule());
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [exact, setExact] = useState<string | null>(null);
  const [exactLoading, setExactLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const newSegment = () => { setEditingId(null); setName(""); setDescription(""); setRule(emptyRule()); setExact(null); };

  async function loadSegment(id: string) {
    setError(null);
    const res = await fetch(`/api/segment-definitions/${id}`);
    if (!res.ok) { setError("Failed to load segment"); return; }
    const body = await res.json() as { data: { name: string; description: string | null; rule: SegmentRule } };
    setEditingId(id);
    setName(body.data.name);
    setDescription(body.data.description ?? "");
    setRule(body.data.rule);
    setExact(null);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEstimating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/segment-definitions/size", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "estimate", rule }),
        });
        if (res.ok) { const b = await res.json(); setEstimate(b.data.count); }
      } finally {
        setEstimating(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [rule]);

  async function getExact() {
    setExactLoading(true);
    setExact(null);
    try {
      const res = await fetch("/api/segment-definitions/size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "exact", rule }),
      });
      const b = await res.json();
      setExact(b.data?.timedOut ? "timed out — refine the segment" : `${b.data.count}`);
    } finally {
      setExactLoading(false);
    }
  }

  async function save() {
    setError(null);
    if (!name.trim()) { setError("Name is required"); return; }
    const method = editingId ? "PUT" : "POST";
    const url = editingId ? `/api/segment-definitions/${editingId}` : "/api/segment-definitions";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, rule }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Failed to save"); return;
    }
    router.refresh();
  }

  async function remove() {
    if (!editingId) return;
    if (!confirm("Delete this segment?")) return;
    await fetch(`/api/segment-definitions/${editingId}`, { method: "DELETE" });
    newSegment();
    router.refresh();
  }

  const ctx: EditorContext = {
    personaOptions,
    segmentNameOptions,
    onAddCondition: useCallback((path) => setRule((r) => addChild(r, path, firstCondition())), []),
    onAddGroup: useCallback((path) => setRule((r) => addChild(r, path, { kind: "group", join: "AND", children: [] })), []),
    onRemove: useCallback((path) => setRule((r) => removeAt(r, path)), []),
    onChangeCondition: useCallback((path, next) => setRule((r) => updateConditionAt(r, path, next)), []),
    onToggleJoin: useCallback((path, join) => setRule((r) => setJoinAt(r, path, join)), []),
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      <div className="space-y-2">
        <button onClick={newSegment} className="w-full rounded-lg border px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90">
          New segment
        </button>
        <div className="rounded-lg border divide-y">
          {segments.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No saved segments yet.</p>
          ) : segments.map((s) => (
            <button key={s.id} onClick={() => loadSegment(s.id)} className={`block w-full text-left px-3 py-2 text-sm hover:bg-muted ${editingId === s.id ? "bg-muted" : ""}`}>
              <div className="font-medium truncate">{s.name}</div>
              <div className="text-[10px] text-muted-foreground">Updated {new Date(s.updatedAt).toLocaleDateString()}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 max-w-3xl">
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" className="flex-1 min-w-48 rounded-lg border bg-background px-3 py-2 text-sm" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="flex-1 min-w-48 rounded-lg border bg-background px-3 py-2 text-sm" />
        </div>

        <RuleNodeEditor node={rule} path={[]} ctx={ctx} />

        <div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Estimated size: </span>
            <span className="font-semibold">{estimating ? "estimating…" : estimate === null ? "—" : `≈ ${estimate.toLocaleString()} users`}</span>
          </div>
          <button onClick={getExact} disabled={exactLoading} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            {exactLoading ? "counting…" : "Get exact count"}
          </button>
          {exact !== null && <span className="text-sm font-semibold">{exact}</span>}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button onClick={save} className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90">
            {editingId ? "Save changes" : "Create segment"}
          </button>
          {editingId && (
            <button onClick={remove} className="rounded-lg border px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
