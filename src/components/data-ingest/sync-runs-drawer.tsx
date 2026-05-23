"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { HightouchSyncRun } from "@/lib/hightouch/types";

function statusClasses(status: HightouchSyncRun["status"]): string {
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

function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt || !finishedAt) return "—";
  const diff =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (diff < 0) return "—";
  const totalSec = Math.floor(diff / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startedAt));
}

// Isolated component so the useEffect only fires when mounted (drawer open).
// Mounted/unmounted via `open` prop on Sheet, which means no state reset in effect needed.
function RunsContent({ syncId }: { syncId: string }) {
  const [runs, setRuns] = useState<HightouchSyncRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetch(`/api/hightouch/syncs/${syncId}/runs`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json: { data?: HightouchSyncRun[]; error?: string }) => {
        if (!active) return;
        if (json.error) {
          setError(json.error);
        } else {
          setRuns(json.data ?? []);
        }
      })
      .catch(() => {
        if (active) setError("Failed to load runs");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [syncId]);

  if (error) {
    return <p className="text-xs text-red-600 px-4">{error}</p>;
  }

  if (runs === null) {
    return (
      <div className="space-y-2 px-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6 px-4">
        No runs yet
      </p>
    );
  }

  return (
    <div className="px-4 space-y-2">
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-left font-medium px-3 py-2">Started</th>
              <th className="text-left font-medium px-3 py-2">Duration</th>
              <th className="text-right font-medium px-3 py-2">Rows</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t">
                <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={cn("text-xs capitalize", statusClasses(run.status))}
                  >
                    {run.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {formatStartedAt(run.startedAt)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {formatDuration(run.startedAt, run.finishedAt)}
                </td>
                <td className="px-3 py-2 text-right">
                  {run.plannedRows ? (
                    <span className="space-x-1.5">
                      <span className="text-green-600">
                        +{run.plannedRows.added}
                      </span>
                      <span className="text-yellow-600">
                        ~{run.plannedRows.changed}
                      </span>
                      <span className="text-red-600">
                        -{run.plannedRows.removed}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runs
        .filter((r) => r.status === "failed" && r.error)
        .map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 p-3"
          >
            <p className="text-xs font-medium text-red-700 mb-0.5">Run error</p>
            <p className="text-xs text-red-600">{r.error?.message}</p>
          </div>
        ))}
    </div>
  );
}

type SyncRunsDrawerProps = {
  syncId: string;
  syncName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SyncRunsDrawer({
  syncId,
  syncName,
  open,
  onOpenChange,
}: SyncRunsDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm">Run history — {syncName}</SheetTitle>
        </SheetHeader>
        <div className="pb-4 space-y-2 mt-2">
          {open && <RunsContent syncId={syncId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
