"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2, Send, ChevronDown, ChevronRight, Link2 } from "lucide-react";
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
      </div>
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

  const groups = groupByDate(rows);

  return (
    <div className="space-y-4 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className="w-[100px] sm:w-[130px]">User</TableHead>
            <TableHead>Variant / Message</TableHead>
            <TableHead className="w-[110px] hidden sm:table-cell">Persona</TableHead>
            <TableHead className="w-[60px] sm:w-[80px]">Conv.</TableHead>
            <TableHead className="w-[80px] hidden sm:table-cell">Channel</TableHead>
            <TableHead className="w-[130px] sm:w-[160px] hidden md:table-cell">Delivers</TableHead>
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
                const converted = row.conversionAt !== null;
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => toggleExpanded(row.id)}
                    >
                      {/* Expand chevron */}
                      <TableCell className="pr-0 text-muted-foreground">
                        {isOpen
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />
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
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[260px]">
                            {row.variantTitle}
                          </p>
                        )}
                        {!row.variantTitle && row.variantBody && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[260px]">
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

                      {/* Conversion dot */}
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex h-2 w-2 rounded-full",
                            converted ? "bg-green-500" : "bg-muted-foreground/25",
                          )}
                          title={converted ? `Converted ${formatDateTime(row.conversionAt!)}` : "No conversion yet"}
                        />
                      </TableCell>

                      {/* Channel */}
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs capitalize">
                          {row.channel}
                        </Badge>
                      </TableCell>

                      {/* Delivers */}
                      <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                        {row.scheduledFor ? formatDateTime(row.scheduledFor) : "—"}
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
