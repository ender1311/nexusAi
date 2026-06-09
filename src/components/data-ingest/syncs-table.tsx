"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn, formatRelativeTime } from "@/lib/utils";
import { TriggerSyncButton } from "./trigger-sync-button";
import { SyncRunsDrawer } from "./sync-runs-drawer";
import { SyncNameEdit } from "./sync-name-edit";
import type { HightouchSync, HightouchModel, HightouchDestination } from "@/lib/hightouch/types";
import { syncDisplayName } from "@/lib/hightouch/sync-display-name";

const STATUS_SORT_ORDER: Record<string, number> = {
  failed: 0,
  warning: 1,
  running: 2,
  interrupted: 3,
  cancelled: 4,
  pending: 5,
  queued: 6,
  success: 7,
  disabled: 8,
};

function statusSortKey(s: string): number {
  return STATUS_SORT_ORDER[s] ?? 9;
}

function statusClasses(status: string): string {
  switch (status) {
    case "success":
      return "bg-green-500/15 text-green-700 border-transparent dark:text-green-400";
    case "running":
      return "bg-blue-500/15 text-blue-700 border-transparent dark:text-blue-400";
    case "warning":
      return "bg-yellow-500/15 text-yellow-800 border-transparent dark:text-yellow-400";
    case "failed":
      return "bg-red-500/15 text-red-700 border-transparent dark:text-red-400";
    case "interrupted":
    case "cancelled":
      return "bg-orange-500/15 text-orange-700 border-transparent dark:text-orange-400";
    case "disabled":
      return "bg-muted text-muted-foreground border-transparent";
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}

function formatSchedule(schedule: HightouchSync["schedule"]): string {
  if (!schedule) return "Manual";
  if (schedule.type === "interval" && schedule.expression) return `Every ${schedule.expression}`;
  if (schedule.type === "cron" && schedule.expression) return `Cron: ${schedule.expression}`;
  return schedule.type ? schedule.type.charAt(0).toUpperCase() + schedule.type.slice(1) : "Manual";
}

// Extract useful config metadata for expanded detail rows
function configDetails(cfg: Record<string, unknown>): { label: string; value: string }[] {
  const fields: [string, string][] = [
    ["customSegmentName", "Segment"],
    ["cohortId", "Cohort ID"],
    ["campaignId", "Campaign ID"],
    ["canvasId", "Canvas ID"],
    ["segmentId", "Segment ID"],
    ["audienceId", "Audience ID"],
  ];
  return fields
    .filter(([k]) => cfg[k] != null && String(cfg[k]).trim() !== "")
    .map(([k, label]) => ({ label, value: String(cfg[k]) }));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type SyncItemProps = {
  sync: HightouchSync;
  modelName: string;
  destName: string;
  overrides: Record<string, string>;
};

function SyncCard({ sync, modelName, destName, overrides }: SyncItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const displayName = syncDisplayName(sync, overrides);
  const details = configDetails(sync.configuration);

  return (
    <>
      <div
        className={cn(
          "border-b last:border-b-0",
          sync.status === "failed" && "bg-red-50/40 dark:bg-red-950/10",
        )}
      >
        <button
          type="button"
          className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="shrink-0">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-tight" onClick={(e) => e.stopPropagation()}>
              <SyncNameEdit syncId={String(sync.id)} currentName={displayName} defaultName={syncDisplayName(sync, {})} />
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0 capitalize shrink-0", statusClasses(sync.status))}
              >
                {sync.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(sync.lastRunAt)} · {formatSchedule(sync.schedule)}
              </span>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <TriggerSyncButton syncId={sync.id} syncName={displayName} />
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-3 space-y-2 bg-muted/20 border-t">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Model</p>
                <p className="text-xs mt-0.5 truncate">{modelName}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Destination</p>
                <p className="text-xs mt-0.5 truncate">{destName}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Schedule</p>
                <p className="text-xs mt-0.5">{formatSchedule(sync.schedule)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sync ID</p>
                <p className="text-xs font-mono mt-0.5 truncate">{String(sync.id)}</p>
              </div>
              {sync.slug && (
                <div className="col-span-2">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Slug</p>
                  <p className="text-xs font-mono mt-0.5 truncate">{sync.slug}</p>
                </div>
              )}
              {details.map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                  <p className="text-xs font-mono mt-0.5 truncate">{value}</p>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setDrawerOpen(true)}
            >
              View run history →
            </button>
          </div>
        )}
      </div>

      <SyncRunsDrawer
        syncId={sync.id}
        syncName={displayName}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

function SyncTableRow({ sync, modelName, destName, overrides }: SyncItemProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const displayName = syncDisplayName(sync, overrides);
  return (
    <>
      <tr className="border-t hover:bg-muted/30 transition-colors">
        <td className="px-3 py-2">
          <Badge
            variant="outline"
            className={cn("text-xs capitalize", statusClasses(sync.status))}
          >
            {sync.status}
          </Badge>
        </td>
        <td className="px-3 py-2">
          <span className="text-xs font-medium">
            <SyncNameEdit syncId={String(sync.id)} currentName={displayName} defaultName={syncDisplayName(sync, {})} />
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{modelName}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{destName}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {formatRelativeTime(sync.lastRunAt)}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {formatSchedule(sync.schedule)}
        </td>
        <td className="px-3 py-2 text-right">
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              aria-label="View run history"
              onClick={() => setDrawerOpen(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <History className="h-3.5 w-3.5" />
            </button>
            <TriggerSyncButton syncId={sync.id} syncName={displayName} />
          </span>
        </td>
      </tr>
      <SyncRunsDrawer
        syncId={sync.id}
        syncName={displayName}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

type SyncsTableProps = {
  syncs: HightouchSync[];
  models: HightouchModel[];
  destinations: HightouchDestination[];
  hasApiKey: boolean;
  apiError?: string;
  overrides: Record<string, string>;
};

type SortField = "status" | "name" | "lastRun";

export function SyncsTable({ syncs, models, destinations, hasApiKey, apiError, overrides }: SyncsTableProps) {
  const [nexusOnly, setNexusOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const modelMap = useMemo(
    () => new Map(models.map((m) => [String(m.id), m])),
    [models],
  );
  const destMap = useMemo(
    () => new Map(destinations.map((d) => [String(d.id), d])),
    [destinations],
  );

  // Scope by Nexus-only + search (status counts are computed over this scope so
  // the pill counts match what the user is currently looking at).
  const scoped = useMemo(() => {
    let list = syncs;
    if (nexusOnly) {
      list = list.filter((s) => {
        const dest = destMap.get(String(s.destinationId));
        const destNexus =
          (dest?.name ?? "").toLowerCase().includes("nexus") ||
          (dest?.slug ?? "").toLowerCase().includes("nexus");
        const model = modelMap.get(String(s.modelId));
        const modelNexus =
          (model?.name ?? "").toLowerCase().includes("nexus") ||
          (model?.slug ?? "").toLowerCase().includes("nexus");
        const slugNexus = s.slug.toLowerCase().includes("nexus");
        return destNexus || modelNexus || slugNexus;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) =>
        syncDisplayName(s, overrides).toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (modelMap.get(String(s.modelId))?.name ?? "").toLowerCase().includes(q) ||
        (destMap.get(String(s.destinationId))?.name ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [syncs, nexusOnly, search, modelMap, destMap, overrides]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scoped) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => statusSortKey(a[0]) - statusSortKey(b[0]));
  }, [scoped]);

  const filtered = useMemo(() => {
    let list = scoped;
    if (statusFilter.size > 0) list = list.filter((s) => statusFilter.has(s.status));
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === "status") cmp = statusSortKey(a.status) - statusSortKey(b.status);
      else if (sortField === "name") cmp = syncDisplayName(a, overrides).localeCompare(syncDisplayName(b, overrides));
      else if (sortField === "lastRun") {
        const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
        const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
        cmp = tb - ta;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [scoped, statusFilter, sortField, sortDir, overrides]);

  function toggleStatus(status: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  function sortArrow(field: SortField): string {
    if (sortField !== field) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  if (syncs.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground space-y-1">
        <p>No syncs found.</p>
        {!hasApiKey ? (
          <p className="text-xs">
            Set <code className="font-mono">HIGHTOUCH_API_KEY</code> to load syncs from Hightouch.
          </p>
        ) : apiError ? (
          <p className="text-xs text-destructive">API error: {apiError}</p>
        ) : (
          <p className="text-xs">
            API key is set but no syncs were returned. Check your Hightouch workspace.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search syncs…"
            className="pl-8 h-8 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setNexusOnly((v) => !v)}
          className={cn(
            "text-xs px-3 py-1.5 rounded-md border transition-colors h-8",
            nexusOnly
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:border-foreground",
          )}
        >
          Nexus only
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {syncs.length}
        </span>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setStatusFilter(new Set())}
          className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition-colors",
            statusFilter.size === 0
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:border-foreground",
          )}
        >
          All
        </button>
        {statusCounts.map(([status, count]) => (
          <button
            key={status}
            type="button"
            onClick={() => toggleStatus(status)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              statusFilter.has(status)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-foreground",
            )}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)} {count}
          </button>
        ))}
      </div>

      <div className="rounded-lg border overflow-hidden">
        {/* Mobile: collapsible cards */}
        <div className="sm:hidden divide-y-0">
          {filtered.length === 0 ? (
            <p className="text-center py-8 text-xs text-muted-foreground">No syncs match the current filters.</p>
          ) : (
            filtered.map((sync) => (
              <SyncCard
                key={sync.id}
                sync={sync}
                modelName={modelMap.get(String(sync.modelId))?.name ?? String(sync.modelId).slice(0, 10) + "…"}
                destName={destMap.get(String(sync.destinationId))?.name ?? String(sync.destinationId).slice(0, 10) + "…"}
                overrides={overrides}
              />
            ))
          )}
        </div>

        {/* Desktop: table */}
        <table className="hidden sm:table w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left font-medium px-3 py-2">
                <button type="button" className="hover:text-foreground" onClick={() => toggleSort("status")}>
                  Status{sortArrow("status")}
                </button>
              </th>
              <th className="text-left font-medium px-3 py-2">
                <button type="button" className="hover:text-foreground" onClick={() => toggleSort("name")}>
                  Name{sortArrow("name")}
                </button>
              </th>
              <th className="text-left font-medium px-3 py-2">Model</th>
              <th className="text-left font-medium px-3 py-2">Destination</th>
              <th className="text-left font-medium px-3 py-2">
                <button type="button" className="hover:text-foreground" onClick={() => toggleSort("lastRun")}>
                  Last Run{sortArrow("lastRun")}
                </button>
              </th>
              <th className="text-left font-medium px-3 py-2">Schedule</th>
              <th className="text-right font-medium px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                  No syncs match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((sync) => (
                <SyncTableRow
                  key={sync.id}
                  sync={sync}
                  modelName={modelMap.get(String(sync.modelId))?.name ?? String(sync.modelId).slice(0, 10) + "…"}
                  destName={destMap.get(String(sync.destinationId))?.name ?? String(sync.destinationId).slice(0, 10) + "…"}
                  overrides={overrides}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
