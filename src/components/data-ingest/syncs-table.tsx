"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import { TriggerSyncButton } from "./trigger-sync-button";
import { SyncRunsDrawer } from "./sync-runs-drawer";
import type { HightouchSync } from "@/lib/hightouch/types";

function statusClasses(status: HightouchSync["status"]): string {
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
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}

function formatSchedule(schedule: HightouchSync["schedule"]): string {
  if (!schedule) return "Manual";
  if (schedule.type === "interval" && schedule.expression) {
    return `Every ${schedule.expression}`;
  }
  if (schedule.type === "cron" && schedule.expression) {
    return `Cron: ${schedule.expression}`;
  }
  return schedule.type ? schedule.type.charAt(0).toUpperCase() + schedule.type.slice(1) : "Manual";
}

type SyncItemProps = { sync: HightouchSync };

function SyncCard({ sync }: SyncItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "border-b last:border-b-0",
          sync.status === "failed" && "bg-red-50/40 dark:bg-red-950/10",
        )}
      >
        {/* Header row — always visible */}
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
            <p className="text-sm font-medium truncate leading-tight">{sync.name || "—"}</p>
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
            <TriggerSyncButton syncId={sync.id} syncName={sync.name} />
          </div>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="px-4 pb-3 space-y-2 bg-muted/20 border-t">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sync ID</p>
                <p className="text-xs font-mono mt-0.5 truncate">{String(sync.id)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Destination</p>
                <p className="text-xs font-mono mt-0.5">{String(sync.destinationId).slice(0, 12)}…</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Model</p>
                <p className="text-xs font-mono mt-0.5">{String(sync.modelId).slice(0, 12)}…</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Schedule</p>
                <p className="text-xs mt-0.5">{formatSchedule(sync.schedule)}</p>
              </div>
              {sync.slug && (
                <div className="col-span-2">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Slug</p>
                  <p className="text-xs font-mono mt-0.5 truncate">{sync.slug}</p>
                </div>
              )}
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
        syncName={sync.name}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

function SyncTableRow({ sync }: SyncItemProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
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
          <button
            type="button"
            className="text-xs font-medium hover:underline text-left"
            onClick={() => setDrawerOpen(true)}
          >
            {sync.name}
          </button>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
          {String(sync.destinationId).slice(0, 8)}…
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {formatRelativeTime(sync.lastRunAt)}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {formatSchedule(sync.schedule)}
        </td>
        <td className="px-3 py-2 text-right">
          <TriggerSyncButton syncId={sync.id} syncName={sync.name} />
        </td>
      </tr>
      <SyncRunsDrawer
        syncId={sync.id}
        syncName={sync.name}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

type SyncsTableProps = {
  syncs: HightouchSync[];
  hasApiKey: boolean;
  apiError?: string;
};

export function SyncsTable({ syncs, hasApiKey, apiError }: SyncsTableProps) {
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
            API key is set but no syncs were returned. Check that your Hightouch workspace has syncs configured.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Mobile: collapsible card list */}
      <div className="sm:hidden divide-y-0">
        {syncs.map((sync) => (
          <SyncCard key={sync.id} sync={sync} />
        ))}
      </div>
      {/* Desktop: table */}
      <table className="hidden sm:table w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left font-medium px-3 py-2">Status</th>
            <th className="text-left font-medium px-3 py-2">Name</th>
            <th className="text-left font-medium px-3 py-2">Destination</th>
            <th className="text-left font-medium px-3 py-2">Last Run</th>
            <th className="text-left font-medium px-3 py-2">Schedule</th>
            <th className="text-right font-medium px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {syncs.map((sync) => (
            <SyncTableRow key={sync.id} sync={sync} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
