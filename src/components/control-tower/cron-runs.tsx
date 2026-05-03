"use client";

import { useEffect, useState } from "react";
import { Activity, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CronRun = {
  id: string;
  cronName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  sent: number;
  suppressed: number;
  errors: number;
  agentCount: number;
};

export function CronRuns() {
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cron/runs")
      .then((r) => r.json())
      .then((d: { data: CronRun[] }) => setRuns(d.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Recent Cron Runs</h2>
        <span className="text-xs text-muted-foreground">Last 10 select-and-send executions</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cron runs recorded yet.</p>
      ) : (
        <Card>
          <CardContent className="pt-3 pb-3 px-0">
            <div className="divide-y">
              {runs.slice(0, 10).map((run) => {
                const Icon =
                  run.status === "completed"
                    ? CheckCircle2
                    : run.status === "failed"
                      ? XCircle
                      : Clock;
                const iconColor =
                  run.status === "completed"
                    ? "text-green-500"
                    : run.status === "failed"
                      ? "text-red-400"
                      : "text-amber-500";
                return (
                  <div key={run.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">
                          {new Date(run.startedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-muted-foreground">{run.agentCount} agents</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono shrink-0">
                      <span className="text-green-600">↑{run.sent}</span>
                      <span className="text-muted-foreground">~{run.suppressed}</span>
                      {run.errors > 0 && <span className="text-red-500">✕{run.errors}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
