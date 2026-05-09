"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2, Send, ChevronDown, ChevronRight, Link2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

function ExpandedContent({ row }: { row: SendRow }) {
  return (
    <div className="px-4 py-3 bg-muted/30 border-t space-y-2.5">
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
function ScheduledSection({ rows, expanded, onToggle }: {
  rows: SendRow[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
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
        return (
          <div
            key={row.id}
            className={cn(
              "rounded-lg border overflow-hidden",
              row.failed
                ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20",
            )}
          >
            <button
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5"
              onClick={() => onToggle(row.id)}
            >
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
            {isOpen && <ExpandedContent row={row} />}
          </div>
        );
      })}
    </div>
  );
}

export function AgentSendsTable({ agentId }: Props) {
  const [rows, setRows] = useState<SendRow[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      setStatus("loading");
      try {
        const res = await fetch(`/api/agents/${agentId}/sends?limit=50`);
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
  }, [agentId]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/sends?limit=50&cursor=${cursor}`);
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

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Send className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm font-medium">No sends yet</p>
        <p className="text-xs mt-1">Sends appear here once the cron job delivers messages for this agent.</p>
      </div>
    );
  }

  const now = new Date().toISOString();
  // Scheduled = future scheduledFor (queued with Braze, not yet delivered)
  const scheduledRows = rows.filter((r) => r.scheduledFor && r.scheduledFor > now);
  // Sent = everything else (delivered or immediate)
  const sentRows = rows.filter((r) => !r.scheduledFor || r.scheduledFor <= now);
  const groups = groupByDate(sentRows);

  return (
    <div className="space-y-6">
      {/* Scheduled (future) sends */}
      <ScheduledSection rows={scheduledRows} expanded={expanded} onToggle={toggleExpanded} />

      {/* Sent history */}
      {sentRows.length > 0 && (
        <div className="space-y-1">
          {scheduledRows.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <Send className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Sent — {sentRows.length} decisions
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
                  <TableHead>Variant / Message</TableHead>
                  <TableHead className="w-[110px] hidden sm:table-cell">Persona</TableHead>
                  <TableHead className="w-[80px] hidden sm:table-cell">Channel</TableHead>
                  <TableHead className="w-[70px]">Delivers</TableHead>
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
                      return (
                        <Fragment key={row.id}>
                          <TableRow
                            className={cn(
                              "cursor-pointer",
                              row.failed
                                ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                                : "bg-green-50/40 hover:bg-green-100/50 dark:bg-green-950/10 dark:hover:bg-green-950/20",
                            )}
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
                              {row.failed
                                ? <XCircle className="h-3.5 w-3.5 text-red-500" />
                                : <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              }
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

                            {/* Delivers — short local time */}
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
                                <ExpandedContent row={row} />
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
