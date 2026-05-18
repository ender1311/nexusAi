"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatDate } from "@/lib/utils";

type BrazeStats = {
  sends: number;
  directOpens: number;
  totalOpens: number;
  directOpenRate: number;
  totalOpenRate: number;
};

type PushSummaryData = {
  totalPushSends: number;
  totalPushOpens: number;
  openRate: number;
  firstPushAt: string | null;
  agentCount: number;
  byAgent: Array<{
    agentId: string;
    agentName: string;
    pushSends: number;
    pushOpens: number;
    openRate: number;
    firstPushAt: string;
  }>;
  brazeStats?: BrazeStats;
};

interface PushOpenRateCardProps {
  value: string;
  title?: string;
  description?: string;
}

export function PushOpenRateCard({
  value,
  title = "Push Open Rate",
  description,
}: PushOpenRateCardProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PushSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleOpen() {
    setOpen(true);
    if (data !== null) return; // already fetched
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/metrics/push-summary");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as { data: PushSummaryData };
      setData(json.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Card
        className="cursor-pointer hover:ring-2 hover:ring-ring/20 hover:ring-offset-1 transition-all"
        onClick={handleOpen}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <Eye className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Push Open Rate Details</DialogTitle>
            <DialogDescription>
              Fleet-wide push notification analytics
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
              <div className="space-y-2 mt-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Failed to load details.
            </p>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* Braze Campaign Analytics — authoritative source */}
              {data.brazeStats && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Braze Campaign</p>
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Authoritative</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-lg border p-4 bg-muted/30">
                    <div>
                      <p className="text-xs text-muted-foreground">Sends</p>
                      <p className="text-lg font-bold mt-0.5">{formatNumber(data.brazeStats.sends)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Direct Opens</p>
                      <p className="text-lg font-bold mt-0.5">{formatNumber(data.brazeStats.directOpens)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Opens</p>
                      <p className="text-lg font-bold mt-0.5">{formatNumber(data.brazeStats.totalOpens)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Direct Open Rate</p>
                      <p className="text-lg font-bold mt-0.5 text-primary">{data.brazeStats.directOpenRate.toFixed(2)}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Open Rate</p>
                      <p className="text-lg font-bold mt-0.5">{data.brazeStats.totalOpenRate.toFixed(2)}%</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Nexus DB counts */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nexus DB</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Push Sends</p>
                    <p className="text-xl font-bold mt-0.5">{formatNumber(data.totalPushSends)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Opens Tracked</p>
                    <p className="text-xl font-bold mt-0.5">{formatNumber(data.totalPushOpens)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Open Rate</p>
                    <p className="text-xl font-bold mt-0.5 text-primary">{data.openRate.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tracking Since</p>
                    <p className="text-xl font-bold mt-0.5">
                      {data.firstPushAt ? formatDate(data.firstPushAt) : "—"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Analytics counted from May 16, 2026 · earlier push sends excluded</p>
              </div>

              {/* Per-agent breakdown */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-sm font-semibold">Agents</p>
                  <Badge variant="secondary" className="text-xs">
                    {data.agentCount}
                  </Badge>
                </div>
                {data.byAgent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No agent data available.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left py-2 font-medium">Agent</th>
                        <th className="text-right py-2 font-medium">
                          Push Sends
                        </th>
                        <th className="text-right py-2 font-medium">Opens</th>
                        <th className="text-right py-2 font-medium">
                          Open Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byAgent.map((row) => (
                        <tr
                          key={row.agentId}
                          className="border-b last:border-0 hover:bg-muted/30"
                        >
                          <td className="py-2.5 font-medium">{row.agentName}</td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                            {formatNumber(row.pushSends)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                            {formatNumber(row.pushOpens)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">
                            <span
                              className={
                                row.openRate >= data.openRate
                                  ? "text-green-600 font-medium"
                                  : "text-muted-foreground"
                              }
                            >
                              {row.pushSends > 0
                                ? `${row.openRate.toFixed(2)}%`
                                : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
