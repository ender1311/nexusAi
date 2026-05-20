"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Loader2, Send, ChevronDown, ChevronRight, Link2, Clock, CheckCircle2, XCircle, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getAgentSendDeliveryStatus,
  type AgentSendDeliveryStatus,
} from "@/lib/agent-send-delivery-status";

type SendRow = {
  id: string;
  userId: string;
  channel: string;
  sentAt: string;
  scheduledFor: string | null;
  brazeScheduleId: string | null;
  variantId: string | null;
  variantName: string | null;
  variantTitle: string | null;
  variantBody: string;
  variantDeeplink: string | null;
  brazeSendId: string | null;
  personaName: string | null;
  personaColor: string | null;
  conversionAt: string | null;
  reward: number | null;
  decisionContext: unknown | null;
  failed: boolean;
};

type SortField = "sentAt" | "channel" | "persona" | "variant";
type SortDir = "asc" | "desc";

type Filters = {
  status: "all" | "success" | "failed" | "converted" | "pending";
  channel: string; // "all" or channel name
  persona: string; // "all" or persona name
};

type Props = { agentId: string };

const PERSONA_COLOR_CLASSES: Record<string, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  purple: "bg-purple-500",
  amber:  "bg-amber-500",
  rose:   "bg-rose-500",
  teal:   "bg-teal-500",
  indigo: "bg-indigo-500",
  orange: "bg-orange-500",
  pink:   "bg-pink-500",
  cyan:   "bg-cyan-500",
};

function personaDot(color: string | null): string {
  return PERSONA_COLOR_CLASSES[color ?? ""] ?? "bg-muted-foreground/40";
}

function SendsStatusLegend() {
  const items: { status: AgentSendDeliveryStatus; label: string; detail: string }[] = [
    {
      status: "delivered",
      label: "Delivered",
      detail: "Braze returned success for this send or schedule.",
    },
    {
      status: "failed",
      label: "Failed",
      detail: "Braze returned an error (see expanded row / server logs).",
    },
    {
      status: "pending",
      label: "Pending",
      detail: "Delivery is scheduled for a future time.",
    },
  ];
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Row status
      </p>
      <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-6 sm:gap-y-2">
        {items.map(({ status, label, detail }) => (
          <li key={status} className="flex items-start gap-2 min-w-0 sm:max-w-[220px]">
            <span
              className={cn(
                "mt-0.5 h-2.5 w-2.5 rounded-full shrink-0",
                status === "delivered" && "bg-emerald-500",
                status === "failed" && "bg-red-500",
                status === "pending" && "bg-amber-400",
              )}
              aria-hidden
            />
            <span className="text-xs leading-snug">
              <span className="font-medium text-foreground">{label}</span>
              <span className="text-muted-foreground"> — {detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function rowStatusClasses(status: AgentSendDeliveryStatus): string {
  if (status === "failed") {
    return "bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/30";
  }
  if (status === "pending") {
    return "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/35";
  }
  return "bg-emerald-50/50 hover:bg-emerald-100/60 dark:bg-emerald-950/15 dark:hover:bg-emerald-950/25";
}

const formatDateTime = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));

const formatDateGroup = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));

const toDateKey = (dateStr: string): string => new Date(dateStr).toLocaleDateString("en-CA");

/**
 * Formats the scheduled local delivery time as a short string like "8am" or "12pm".
 * scheduledFor is stored as UTC but represents the user's local delivery hour
 * because Braze uses in_local_time=true — so we read the UTC hour directly.
 */
function formatShortTime(isoStr: string): string {
  const h = new Date(isoStr).getUTCHours();
  const m = new Date(isoStr).getUTCMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Formats scheduled delivery as "May 10, 8am" — used for scheduled future sends
 * where the date matters.
 */
function formatScheduledDelivery(isoStr: string): string {
  const d = new Date(isoStr);
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `${month} ${day}, ${formatShortTime(isoStr)}`;
}

type GroupedRows = { dateKey: string; label: string; rows: SendRow[] }[];

function groupByDate(rows: SendRow[]): GroupedRows {
  const map = new Map<string, { label: string; rows: SendRow[] }>();
  for (const row of rows) {
    const key = toDateKey(row.sentAt);
    if (!map.has(key)) map.set(key, { label: formatDateGroup(row.sentAt), rows: [] });
    map.get(key)!.rows.push(row);
  }
  return Array.from(map.entries()).map(([dateKey, { label, rows }]) => ({ dateKey, label, rows }));
}

function applyFilters(rows: SendRow[], filters: Filters, nowMs: number): SendRow[] {
  return rows.filter((r) => {
    if (filters.status === "success" && r.failed) return false;
    if (filters.status === "failed" && !r.failed) return false;
    if (filters.status === "converted" && !r.conversionAt) return false;
    if (filters.status === "pending" && !(r.scheduledFor && r.scheduledFor > new Date(nowMs).toISOString())) return false;
    if (filters.channel !== "all" && r.channel !== filters.channel) return false;
    if (filters.persona !== "all" && (r.personaName ?? "none") !== filters.persona) return false;
    return true;
  });
}

function applySortToGroups(groups: GroupedRows, field: SortField, dir: SortDir): GroupedRows {
  if (field === "sentAt") {
    // Groups are already date-grouped; flip group order for asc/desc
    return dir === "asc" ? [...groups].reverse() : groups;
  }
  return groups.map((g) => ({
    ...g,
    rows: [...g.rows].sort((a, b) => {
      let av = "";
      let bv = "";
      if (field === "channel") { av = a.channel; bv = b.channel; }
      if (field === "persona") { av = a.personaName ?? ""; bv = b.personaName ?? ""; }
      if (field === "variant") { av = a.variantName ?? ""; bv = b.variantName ?? ""; }
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }),
  }));
}

function SortIcon({ field, active, dir }: { field: SortField; active: SortField; dir: SortDir }) {
  if (field !== active) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />;
  return dir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
}

function deliveryStatusLabel(status: AgentSendDeliveryStatus): string {
  if (status === "failed") return "Failed (Braze error)";
  if (status === "pending") return "Pending (scheduled)";
  return "Delivered (Braze OK)";
}

function ExpandedContent({ row, nowMs }: { row: SendRow; nowMs: number }) {
  const status = getAgentSendDeliveryStatus(row, nowMs);
  return (
    <div className="px-4 py-3 bg-muted/30 border-t space-y-2.5">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Braze status</p>
        <p
          className={cn(
            "text-xs font-medium",
            status === "failed" && "text-red-600 dark:text-red-400",
            status === "pending" && "text-amber-700 dark:text-amber-400",
            status === "delivered" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {deliveryStatusLabel(status)}
        </p>
      </div>
      {row.variantTitle && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Title</p>
          <p className="text-sm font-medium">{row.variantTitle}</p>
        </div>
      )}
      {row.variantBody && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Body</p>
          <p className="text-sm text-foreground/80 leading-relaxed">{row.variantBody}</p>
        </div>
      )}
      {row.variantDeeplink && (
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground font-mono truncate">{row.variantDeeplink}</p>
        </div>
      )}
      {(() => {
        const ctx = row.decisionContext as { selectedVariantId?: string; variantScores?: Record<string, number> } | null;
        const scores = ctx?.variantScores;
        if (!scores || Object.keys(scores).length === 0) return null;
        const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
        const maxScore = sorted[0]?.[1] ?? 1;
        return (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Arm probabilities at decide-time
            </p>
            <div className="space-y-1">
              {sorted.map(([vid, score]) => {
                const isSelected = vid === ctx?.selectedVariantId;
                const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
                return (
                  <div key={vid} className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-mono w-16 shrink-0", isSelected && "text-primary font-semibold")}>
                      {isSelected ? "★ " : "  "}{vid.slice(-6)}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", isSelected ? "bg-primary" : "bg-muted-foreground/30")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{(score * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      <div className="flex flex-wrap gap-4 pt-1 border-t border-dashed">
        {row.brazeSendId && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Braze Send ID</p>
            <p className="text-xs font-mono text-muted-foreground">{row.brazeSendId}</p>
          </div>
        )}
        {row.brazeScheduleId && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Braze Schedule ID</p>
            <p className="text-xs font-mono text-muted-foreground">{row.brazeScheduleId}</p>
          </div>
        )}
        {row.conversionAt && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Converted</p>
            <p className="text-xs text-green-700">{formatDateTime(row.conversionAt)}</p>
          </div>
        )}
        {row.reward !== null && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Reward</p>
            <p className="text-xs font-mono">{row.reward.toFixed(2)}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">User ID</p>
          <p className="text-xs font-mono text-muted-foreground">{row.userId}</p>
        </div>
        {row.scheduledFor && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Scheduled for</p>
            <p className="text-xs font-mono">{formatScheduledDelivery(row.scheduledFor)} local</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Scheduled (future) sends — compact card list above the main sent table */
function ScheduledSection({ rows, expanded, onToggle, nowMs }: {
  rows: SendRow[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  nowMs: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Scheduled — {rows.length} pending
        </span>
      </div>
      {rows.map((row) => {
        const isOpen = expanded.has(row.id);
        const st = getAgentSendDeliveryStatus(row, nowMs);
        return (
          <div
            key={row.id}
            className={cn(
              "rounded-lg border overflow-hidden",
              st === "failed" && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20",
              st === "pending" && "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20",
              st === "delivered" && "border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-950/15",
            )}
          >
            <button
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5"
              onClick={() => onToggle(row.id)}
            >
              <span className="shrink-0 w-3.5 flex justify-center">
                {st === "failed" ? (
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                ) : st === "pending" ? (
                  <Clock className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                )}
              </span>
              {isOpen
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{row.variantName ?? "—"}</span>
                  {row.personaName && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", personaDot(row.personaColor))} />
                      {row.personaName}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {row.userId.length > 14 ? `${row.userId.slice(0, 14)}…` : row.userId}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">
                  <Clock className="h-2.5 w-2.5 mr-1" />
                  {row.scheduledFor ? formatScheduledDelivery(row.scheduledFor) : "—"}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize hidden sm:inline-flex">{row.channel}</Badge>
              </div>
            </button>
            {isOpen && <ExpandedContent row={row} nowMs={nowMs} />}
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_FILTERS: Filters = { status: "all", channel: "all", persona: "all" };

function filtersActive(f: Filters): boolean {
  return f.status !== "all" || f.channel !== "all" || f.persona !== "all";
}

export function AgentSendsTable({ agentId }: Props) {
  const [rows, setRows] = useState<SendRow[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortField, setSortField] = useState<SortField>("sentAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      setRows([]);
      setCursor(null);
      setHasMore(false);
      setStatus("loading");
      try {
        const qs = new URLSearchParams({ limit: "50" });
        if (filters.status !== "all") qs.set("status", filters.status);
        if (filters.channel !== "all") qs.set("channel", filters.channel);
        const res = await fetch(`/api/agents/${agentId}/sends?${qs.toString()}`);
        if (!res.ok) throw new Error("non-ok response");
        const json = (await res.json()) as { data: SendRow[] };
        if (cancelled) return;
        const fetched = json.data;
        setRows(fetched);
        setStatus("idle");
        const lastId = fetched.length > 0 ? fetched[fetched.length - 1].id : null;
        setCursor(lastId);
        setHasMore(fetched.length === 50);
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void fetchInitial();
    return () => { cancelled = true; };
  }, [agentId, filters.status, filters.channel]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ limit: "50", cursor });
      if (filters.status !== "all") qs.set("status", filters.status);
      if (filters.channel !== "all") qs.set("channel", filters.channel);
      const res = await fetch(`/api/agents/${agentId}/sends?${qs.toString()}`);
      if (!res.ok) throw new Error("non-ok response");
      const json = (await res.json()) as { data: SendRow[] };
      const fetched = json.data;
      setRows((prev) => [...prev, ...fetched]);
      const lastId = fetched.length > 0 ? fetched[fetched.length - 1].id : null;
      setCursor(lastId);
      setHasMore(fetched.length === 50);
    } catch {
      // silently fail on load-more; existing rows remain intact
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  // Derive filter options from loaded rows
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel))].sort(), [rows]);
  const personas = useMemo(
    () => [...new Set(rows.map((r) => r.personaName ?? "none"))].filter((p) => p !== "none").sort(),
    [rows],
  );

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const scheduledRows = rows.filter((r) => r.scheduledFor && r.scheduledFor > nowIso);
  const sentRows = rows.filter((r) => !r.scheduledFor || r.scheduledFor <= nowIso);

  const filteredSentRows = useMemo(() => applyFilters(sentRows, filters, nowMs), [sentRows, filters, nowMs]);
  const groups = useMemo(
    () => applySortToGroups(groupByDate(filteredSentRows), sortField, sortDir),
    [filteredSentRows, sortField, sortDir],
  );

  const activeFilterCount = [
    filters.status !== "all",
    filters.channel !== "all",
    filters.persona !== "all",
  ].filter(Boolean).length;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return <p className="text-center py-8 text-sm text-red-500/80">Failed to load sends.</p>;
  }

  if (rows.length === 0 && !filtersActive(filters)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Send className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm font-medium">No sends yet</p>
        <p className="text-xs mt-1">Sends appear here once the cron job delivers messages for this agent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter / sort toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal className="h-3 w-3" />
          Filter
          {activeFilterCount > 0 && (
            <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {/* Status quick-filter chips */}
        {(["failed", "pending", "success"] as const).map((s) => {
          const isActive = filters.status === s;
          const label = s === "success" ? "Delivered" : s === "pending" ? "Pending" : "Failed";
          return (
            <button
              key={s}
              onClick={() => setFilters((f) => ({ ...f, status: isActive ? "all" : s }))}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                s === "failed" && !isActive && "border-border text-muted-foreground hover:border-red-300 hover:text-red-600 dark:hover:border-red-700 dark:hover:text-red-400",
                s === "failed" && isActive  && "border-red-400 bg-red-100 text-red-700 dark:border-red-700 dark:bg-red-950/50 dark:text-red-400",
                s === "pending" && !isActive && "border-border text-muted-foreground hover:border-amber-300 hover:text-amber-600 dark:hover:border-amber-700 dark:hover:text-amber-400",
                s === "pending" && isActive  && "border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
                s === "success" && !isActive && "border-border text-muted-foreground hover:border-emerald-300 hover:text-emerald-600 dark:hover:border-emerald-700 dark:hover:text-emerald-400",
                s === "success" && isActive  && "border-emerald-400 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  s === "failed"  && "bg-red-500",
                  s === "pending" && "bg-amber-400",
                  s === "success" && "bg-emerald-500",
                )}
              />
              {label}
            </button>
          );
        })}

        {/* Active filter pills */}
        {filters.channel !== "all" && (
          <span className="flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs capitalize">
            {filters.channel}
            <button onClick={() => setFilters((f): Filters => ({ ...f, channel: "all" }))}>
              <X className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
            </button>
          </span>
        )}
        {filters.persona !== "all" && (
          <span className="flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs">
            {filters.persona}
            <button onClick={() => setFilters((f): Filters => ({ ...f, persona: "all" }))}>
              <X className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
            </button>
          </span>
        )}
        {filtersActive(filters) && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            Clear all
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {filteredSentRows.length !== sentRows.length
            ? `${filteredSentRows.length} of ${sentRows.length} sends`
            : `${sentRows.length} sends`}
        </span>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status</label>
            <Select
              value={filters.status}
              onValueChange={(v) => setFilters((f) => ({ ...f, status: v as Filters["status"] }))}
            >
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All</SelectItem>
                <SelectItem value="success" className="text-xs">Delivered</SelectItem>
                <SelectItem value="failed" className="text-xs">Failed</SelectItem>
                <SelectItem value="pending" className="text-xs">Pending</SelectItem>
                <SelectItem value="converted" className="text-xs">Converted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {channels.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Channel</label>
              <Select
                value={filters.channel}
                onValueChange={(v) => setFilters((f) => ({ ...f, channel: v ?? f.channel }))}
              >
                <SelectTrigger className="h-7 w-[110px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {personas.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Persona</label>
              <Select
                value={filters.persona}
                onValueChange={(v) => setFilters((f) => ({ ...f, persona: v ?? f.persona }))}
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All</SelectItem>
                  {personas.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <SendsStatusLegend />

      {/* Scheduled (future) sends */}
      <ScheduledSection rows={scheduledRows} expanded={expanded} onToggle={toggleExpanded} nowMs={nowMs} />

      {/* Sent history */}
      {filteredSentRows.length === 0 ? (
        <p className="text-center py-6 text-sm text-muted-foreground">No sends match the current filters.</p>
      ) : (
        <div className="space-y-1">
          {scheduledRows.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <Send className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Sent — {filteredSentRows.length} decisions
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-8" />
                  <TableHead className="w-[100px] sm:w-[130px]">User</TableHead>
                  <TableHead>
                    <button
                      className="flex items-center text-xs font-medium hover:text-foreground"
                      onClick={() => handleSort("variant")}
                    >
                      Variant
                      <SortIcon field="variant" active={sortField} dir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[110px] hidden sm:table-cell">
                    <button
                      className="flex items-center text-xs font-medium hover:text-foreground"
                      onClick={() => handleSort("persona")}
                    >
                      Persona
                      <SortIcon field="persona" active={sortField} dir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[80px] hidden sm:table-cell">
                    <button
                      className="flex items-center text-xs font-medium hover:text-foreground"
                      onClick={() => handleSort("channel")}
                    >
                      Channel
                      <SortIcon field="channel" active={sortField} dir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="w-[70px]">
                    <button
                      className="flex items-center text-xs font-medium hover:text-foreground"
                      onClick={() => handleSort("sentAt")}
                    >
                      Time
                      <SortIcon field="sentAt" active={sortField} dir={sortDir} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(({ dateKey, label, rows: groupRows }) => (
                  <Fragment key={dateKey}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={7}
                        className="py-2 px-4 text-xs font-medium text-muted-foreground bg-muted/40 border-y"
                      >
                        {label}
                      </TableCell>
                    </TableRow>
                    {groupRows.map((row) => {
                      const isOpen = expanded.has(row.id);
                      const st = getAgentSendDeliveryStatus(row, nowMs);
                      return (
                        <Fragment key={row.id}>
                          <TableRow
                            className={cn("cursor-pointer", rowStatusClasses(st))}
                            onClick={() => toggleExpanded(row.id)}
                          >
                            {/* Expand chevron */}
                            <TableCell className="pr-0 text-muted-foreground">
                              {isOpen
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />
                              }
                            </TableCell>

                            {/* Status icon */}
                            <TableCell className="pr-0">
                              {st === "failed" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                              {st === "delivered" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                              {st === "pending" && <Clock className="h-3.5 w-3.5 text-amber-500" />}
                            </TableCell>

                            {/* User */}
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {row.userId.length > 12 ? `${row.userId.slice(0, 12)}…` : row.userId}
                            </TableCell>

                            {/* Variant + title preview */}
                            <TableCell>
                              <p className="text-sm font-medium leading-none">
                                {row.variantName ?? <span className="text-muted-foreground">—</span>}
                              </p>
                              {row.variantTitle && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                                  {row.variantTitle}
                                </p>
                              )}
                              {!row.variantTitle && row.variantBody && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">
                                  {row.variantBody}
                                </p>
                              )}
                            </TableCell>

                            {/* Persona */}
                            <TableCell className="hidden sm:table-cell">
                              {row.personaName ? (
                                <div className="flex items-center gap-1.5">
                                  <span className={cn("h-2 w-2 rounded-full shrink-0", personaDot(row.personaColor))} />
                                  <span className="text-xs">{row.personaName}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>

                            {/* Channel */}
                            <TableCell className="hidden sm:table-cell">
                              <Badge variant="outline" className="text-xs capitalize">
                                {row.channel}
                              </Badge>
                            </TableCell>

                            {/* Time — short local time or "now" */}
                            <TableCell className="text-xs font-medium tabular-nums">
                              {row.scheduledFor
                                ? <span className="text-foreground/70">{formatShortTime(row.scheduledFor)}</span>
                                : <span className="text-muted-foreground">now</span>
                              }
                            </TableCell>
                          </TableRow>

                          {/* Expanded detail row */}
                          {isOpen && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={7} className="p-0">
                                <ExpandedContent row={row} nowMs={nowMs} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
