"use client";

import { Fragment, useMemo, useState } from "react";
import { Loader2, Send, ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, SlidersHorizontal, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyableId } from "@/components/ui/copyable-id";
import { cn } from "@/lib/utils";
import { getAgentSendDeliveryStatus } from "@/lib/agent-send-delivery-status";
import { formatShortTime } from "@/lib/agent-sends/format";
import {
  applyFilters,
  applySortToGroups,
  buildVariantNameMap,
  DEFAULT_FILTERS,
  filtersActive,
  groupByDate,
} from "@/lib/agent-sends/grouping";
import { isPendingDelivery } from "@/lib/agent-sends/pending-deadline";
import type { Filters, SortDir, SortField } from "@/lib/agent-sends/types";
import { useAgentSends } from "./use-agent-sends";
import { ConvergencePanel } from "./sends/convergence-panel";
import { ExpandedContent } from "./sends/expanded-content";
import { ScheduledSection } from "./sends/scheduled-section";
import { SendsStatusLegend } from "./sends/sends-status-legend";
import { SortIcon } from "./sends/sort-icon";
import { personaDot, rowStatusClasses } from "./sends/presentation";

type Props = { agentId: string };

export function AgentSendsTable({ agentId }: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const { rows, status, hasMore, loadingMore, loadMore } = useAgentSends(agentId, filters);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("sentAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showFilters, setShowFilters] = useState(false);

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
  const variantNameMap = useMemo(() => buildVariantNameMap(rows), [rows]);

  // Captured once at mount — a stable reference instant for delivered/pending
  // classification; avoids impure Date.now() reads during render.
  const [nowMs] = useState(() => Date.now());
  const scheduledRows = rows.filter((r) => isPendingDelivery(r, nowMs));
  const sentRows = rows.filter((r) => !isPendingDelivery(r, nowMs));

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

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {(() => {
            const showPending = filters.status === "all" || filters.status === "pending";
            const visibleCount = filteredSentRows.length + (showPending ? scheduledRows.length : 0);
            const totalCount = sentRows.length + scheduledRows.length;
            return visibleCount !== totalCount
              ? `${visibleCount} of ${totalCount} sends`
              : `${totalCount} sends`;
          })()}
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

      <ConvergencePanel rows={sentRows} />

      <SendsStatusLegend />

      {/* Scheduled (future) sends — hidden when filter explicitly excludes pending */}
      {(filters.status === "all" || filters.status === "pending") && (
        <ScheduledSection rows={scheduledRows} expanded={expanded} onToggle={toggleExpanded} nowMs={nowMs} variantNameMap={variantNameMap} />
      )}

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
                            <TableCell className="text-xs text-muted-foreground">
                              <CopyableId
                                id={row.userId}
                                display={row.userId.length > 12 ? `${row.userId.slice(0, 12)}…` : row.userId}
                              />
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
                                <ExpandedContent row={row} nowMs={nowMs} variantNameMap={variantNameMap} />
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
