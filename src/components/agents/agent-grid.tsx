"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bot, Columns2, GripVertical, LayoutGrid, List, Trash2 } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Agent, agentTargetingLabel } from "@/types/agent";
import type { StatKey } from "@/lib/stat-visibility";
import { AgentCard } from "./agent-card";
import { AgentStatusBadge } from "./agent-status-badge";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SortMode = "custom" | "alpha" | "decisions" | "cap";
type ViewMode = "grid" | "list";
type ConvergenceState = "exploring" | "learning" | "converging" | "confident";

const CONVERGENCE_CONFIG: Record<ConvergenceState, { label: string; dotClass: string; textClass: string }> = {
  exploring:  { label: "Exploring",  dotClass: "bg-blue-500",   textClass: "text-blue-600 dark:text-blue-400" },
  learning:   { label: "Learning",   dotClass: "bg-amber-500",  textClass: "text-amber-600 dark:text-amber-400" },
  converging: { label: "Converging", dotClass: "bg-green-500",  textClass: "text-green-600 dark:text-green-400" },
  confident:  { label: "Confident",  dotClass: "bg-emerald-600",textClass: "text-emerald-700 dark:text-emerald-400" },
};

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson",
  epsilon_greedy: "ε-Greedy",
  linucb: "LinUCB",
};

// ─── Column definitions ────────────────────────────────────────────────────────

type ColumnKey = "status" | "convergence" | "algorithm" | "stage" | "dailyCap" | "decisions" | "assigned" | "openRate";

type ColumnDef = { key: ColumnKey; label: string };

const COLUMNS: ColumnDef[] = [
  { key: "status",      label: "Status" },
  { key: "convergence", label: "Convergence" },
  { key: "algorithm",   label: "Algorithm" },
  { key: "stage",       label: "Stage" },
  { key: "dailyCap",    label: "Daily Cap" },
  { key: "decisions",   label: "Decisions" },
  { key: "assigned",    label: "Assigned" },
  { key: "openRate",    label: "Open Rate" },
];

const LS_VIEW    = "nexus:agent-view";
const LS_COLUMNS = "nexus:agent-list-hidden-cols";

function renderListCell(
  key: ColumnKey,
  agent: Agent,
  convergenceState: ConvergenceState | undefined,
): React.ReactNode {
  switch (key) {
    case "status":
      return <AgentStatusBadge status={agent.status} />;

    case "convergence": {
      if (!convergenceState) return <span className="text-xs text-muted-foreground">—</span>;
      const cfg = CONVERGENCE_CONFIG[convergenceState];
      return (
        <span className={cn("flex items-center gap-1.5 text-xs font-medium", cfg.textClass)}>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dotClass)} />
          {cfg.label}
        </span>
      );
    }

    case "algorithm":
      return <span className="text-xs">{algorithmLabels[agent.algorithm] ?? agent.algorithm}</span>;

    case "stage":
      return (
        <Badge variant="secondary" className="text-xs font-normal whitespace-nowrap">
          {agentTargetingLabel(agent)}
        </Badge>
      );

    case "dailyCap":
      return (
        <span className="text-xs tabular-nums">
          {agent.dailySendCap != null ? formatNumber(agent.dailySendCap) : "—"}
        </span>
      );

    case "decisions":
      return (
        <span className="text-xs tabular-nums">
          {agent._count ? formatNumber(agent._count.decisions) : "—"}
        </span>
      );

    case "assigned": {
      const assigned = agent.assigned ?? 0;
      const cap = agent.uniqueUsersCap;
      const pct = cap && cap > 0 ? Math.min(100, Math.round((assigned / cap) * 100)) : null;
      return (
        <span className="text-xs tabular-nums">
          {formatNumber(assigned)}
          <span className="text-muted-foreground">
            {" "}/ {cap != null ? formatNumber(cap) : "∞"}
            {pct !== null ? ` (${pct}%)` : ""}
          </span>
        </span>
      );
    }

    case "openRate":
      if (agent.pushOpenRate == null) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <span className="text-xs font-semibold tabular-nums text-primary">
          {agent.pushOpenRate.toFixed(1)}%
        </span>
      );
  }
}

// ─── Existing grid helpers ─────────────────────────────────────────────────────

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "custom",    label: "Custom" },
  { value: "alpha",     label: "Name A–Z" },
  { value: "decisions", label: "Most Decisions" },
  { value: "cap",       label: "Daily cap ↑" },
];

function sortAgents(agents: Agent[], mode: SortMode): Agent[] {
  if (mode === "custom") return agents;
  const copy = [...agents];
  if (mode === "alpha") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === "decisions") {
    copy.sort((a, b) => (b._count?.decisions ?? 0) - (a._count?.decisions ?? 0));
  } else if (mode === "cap") {
    copy.sort((a, b) => {
      const capA = a.dailySendCap ?? Infinity;
      const capB = b.dailySendCap ?? Infinity;
      return capA - capB;
    });
  }
  return copy;
}

function SortableAgent({
  agent, convergenceState, hiddenStats, isCustom, isAdmin, killSwitchOn, onDelete,
}: {
  agent: Agent;
  convergenceState?: ConvergenceState;
  hiddenStats?: StatKey[];
  isCustom: boolean;
  isAdmin?: boolean;
  killSwitchOn?: boolean;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
    disabled: !isCustom,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative group h-full", isDragging && "opacity-50 z-50")}
    >
      {isCustom && (
        <div
          {...attributes}
          {...listeners}
          className={cn(
            "absolute left-1 top-1/2 -translate-y-1/2 z-10 p-1 rounded",
            "text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors",
            "opacity-0 group-hover:opacity-100",
            "cursor-grab active:cursor-grabbing touch-none",
          )}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <AgentCard
        agent={agent}
        convergenceState={convergenceState}
        hiddenStats={hiddenStats}
        isAdmin={isAdmin}
        killSwitchOn={killSwitchOn}
        onDelete={onDelete}
      />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface AgentGridProps {
  agents: Agent[];
  convergenceStates?: Record<string, ConvergenceState>;
  hiddenStats?: StatKey[];
  isAdmin?: boolean;
  killSwitchOn?: boolean;
}

export function AgentGrid({
  agents: initialAgents,
  convergenceStates,
  hiddenStats,
  isAdmin = false,
  killSwitchOn = false,
}: AgentGridProps) {
  const router = useRouter();
  const [sortMode, setSortMode]     = useState<SortMode>("custom");
  const [customOrder, setCustomOrder] = useState<Agent[]>(initialAgents);
  const [viewMode, setViewMode]     = useState<ViewMode>("grid");
  const [hiddenCols, setHiddenCols] = useState<Set<ColumnKey>>(new Set());
  const [colsOpen, setColsOpen]     = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  // Pending delete confirmation for list view
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Restore persisted preferences
  useEffect(() => {
    const v = localStorage.getItem(LS_VIEW);
    if (v === "grid" || v === "list") setViewMode(v);
    const c = localStorage.getItem(LS_COLUMNS);
    if (c) {
      try { setHiddenCols(new Set(JSON.parse(c) as ColumnKey[])); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => { localStorage.setItem(LS_VIEW, viewMode); }, [viewMode]);

  // Close columns dropdown on outside click
  useEffect(() => {
    if (!colsOpen) return;
    function onDown(e: MouseEvent) {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colsOpen]);

  function toggleCol(key: ColumnKey) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(LS_COLUMNS, JSON.stringify([...next]));
      return next;
    });
  }

  function setAllCols(visible: boolean) {
    const next = visible ? new Set<ColumnKey>() : new Set(COLUMNS.map((c) => c.key));
    setHiddenCols(next);
    localStorage.setItem(LS_COLUMNS, JSON.stringify([...next]));
  }

  // DnD sensors — activate with 8px movement; touch requires 250ms press
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const displayed = sortMode === "custom" ? customOrder : sortAgents(initialAgents, sortMode);

  function handleDelete(id: string) {
    setCustomOrder((prev) => prev.filter((a) => a.id !== id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = customOrder.findIndex((a) => a.id === active.id);
    const newIndex  = customOrder.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const prev = customOrder;
    const next = arrayMove(customOrder, oldIndex, newIndex);
    setCustomOrder(next);

    fetch("/api/agents/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((a) => a.id) }),
    }).then((res) => {
      if (res.ok) router.refresh();
      else setCustomOrder(prev);
    }).catch(() => setCustomOrder(prev));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${pendingDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to delete agent" }));
        throw new Error(body.error ?? "Failed to delete agent");
      }
      handleDelete(pendingDelete.id);
      router.refresh();
      toast.success(`Agent "${pendingDelete.name}" deleted`);
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  }

  const visibleColumns = COLUMNS.filter((c) => !hiddenCols.has(c.key));
  const allVisible = hiddenCols.size === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Sort pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSortMode(opt.value)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors border",
                sortMode === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-2">
          {/* Columns picker — list mode only */}
          {viewMode === "list" && (
            <div className="relative" ref={colsRef}>
              <button
                onClick={() => setColsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors",
                  colsOpen
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/40",
                )}
              >
                <Columns2 className="h-3.5 w-3.5" />
                Columns
              </button>

              {colsOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-30 bg-background border rounded-lg shadow-lg py-1.5 min-w-[160px]">
                  <label className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted cursor-pointer text-xs font-semibold border-b pb-2 mb-1">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded"
                      checked={allVisible}
                      onChange={() => setAllCols(!allVisible)}
                    />
                    All Columns
                  </label>
                  {COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded"
                        checked={!hiddenCols.has(col.key)}
                        onChange={() => toggleCol(col.key)}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* View mode toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
          </div>
        </div>
      </div>

      {/* ── Grid view ─────────────────────────────────────────────────────────── */}
      {viewMode === "grid" ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayed.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {displayed.map((agent) => (
                <SortableAgent
                  key={agent.id}
                  agent={agent}
                  convergenceState={convergenceStates?.[agent.id]}
                  hiddenStats={hiddenStats}
                  isCustom={sortMode === "custom"}
                  isAdmin={isAdmin}
                  killSwitchOn={killSwitchOn}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        /* ── List view ──────────────────────────────────────────────────────── */
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground min-w-[200px]">
                  Name
                </th>
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {col.label}
                  </th>
                ))}
                {isAdmin && <th className="px-4 py-2.5 w-10" />}
              </tr>
            </thead>
            <tbody>
              {displayed.map((agent, i) => (
                <tr
                  key={agent.id}
                  className={cn("border-t hover:bg-muted/20 transition-colors", i % 2 !== 0 && "bg-muted/10")}
                >
                  {/* Name — always leftmost */}
                  <td className="px-4 py-3">
                    <Link href={`/agents/${agent.id}`} className="flex items-center gap-2.5 group min-w-0">
                      <div
                        className="h-7 w-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${agent.color}20` }}
                      >
                        <Bot className="h-3.5 w-3.5" style={{ color: agent.color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {agent.name}
                        </p>
                        {agent.description && (
                          <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                            {agent.description}
                          </p>
                        )}
                      </div>
                    </Link>
                  </td>

                  {/* Dynamic columns */}
                  {visibleColumns.map((col) => (
                    <td key={col.key} className="px-4 py-3 whitespace-nowrap">
                      {renderListCell(col.key, agent, convergenceStates?.[agent.id])}
                    </td>
                  ))}

                  {/* Admin delete */}
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setPendingDelete({ id: agent.id, name: agent.name })}
                        className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label={`Delete ${agent.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
            {displayed.length} agent{displayed.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Delete confirmation (list view) */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{pendingDelete?.name}</strong> and all its goals, messages, variants,
              decisions, and arm stats will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete Agent"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
