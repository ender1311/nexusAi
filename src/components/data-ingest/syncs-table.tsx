"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import { TriggerSyncButton } from "./trigger-sync-button";
import { SyncRunsDrawer } from "./sync-runs-drawer";
import type { HightouchSync } from "@/lib/hightouch/types";

function statusClasses(status: HightouchSync["status"]): string {
  switch (status) {
    case "success":
      return "bg-green-500/15 text-green-700 border-transparent";
    case "running":
      return "bg-blue-500/15 text-blue-700 border-transparent";
    case "warning":
      return "bg-yellow-500/15 text-yellow-800 border-transparent";
    case "failed":
      return "bg-red-500/15 text-red-700 border-transparent";
    case "interrupted":
    case "cancelled":
      return "bg-orange-500/15 text-orange-700 border-transparent";
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

type SyncItemProps = {
  sync: HightouchSync;
};

function SyncCard({ sync }: SyncItemProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <div className="flex items-start gap-3 px-3 py-3 hover:bg-muted/30 transition-colors">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn("text-xs capitalize shrink-0", statusClasses(sync.status))}
            >
              {sync.status}
            </Badge>
            <button
              type="button"
              className="text-xs font-medium hover:underline text-left"
              onClick={() => setDrawerOpen(true)}
            >
              {sync.name}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatRelativeTime(sync.lastRunAt)} · {formatSchedule(sync.schedule)}
          </p>
        </div>
        <TriggerSyncButton syncId={sync.id} syncName={sync.name} />
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
          {sync.destinationId.slice(0, 8)}…
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
          <p className="text-xs text-destructive">
            API error: {apiError}
          </p>
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
      {/* Mobile: card list */}
      <div className="sm:hidden divide-y">
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
