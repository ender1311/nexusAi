"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type BrazeStats = {
  sends: number;
  directOpens: number;
  totalOpens: number;
  directOpenRate: number;
  totalOpenRate: number;
};

type OpenRatePoint = {
  date: string;
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
  series?: OpenRatePoint[];
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
      <div
        className="rounded-2xl border bg-card px-5 pt-5 pb-4 flex flex-col gap-3 min-h-[148px] h-full cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/40"
        onClick={handleOpen}
      >
        <div className="inline-flex w-fit items-center justify-center rounded-xl p-2.5 bg-amber-500/10">
          <Eye className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <div className="text-3xl font-extrabold tracking-tight leading-none">{value}</div>
          <p className="text-xs font-medium text-muted-foreground mt-1.5">{title}</p>
          {description && (
            <p className="text-xs font-medium text-amber-500 mt-1">{description}</p>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Push Open Rate Details</DialogTitle>
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
              {/* 28-day open rate trend chart */}
              {data.series && data.series.length > 1 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Open Rate — Last 28 Days</p>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={data.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v: string) => {
                            const d = new Date(v + "T00:00:00");
                            return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                          }}
                          tick={{ fontSize: 11 }}
                          interval="preserveStartEnd"
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, 30]}
                          tickFormatter={(v: number) => `${v}%`}
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={38}
                        />
                        <Tooltip
                          formatter={(value) => [`${typeof value === "number" ? Math.round(value) : value}%`]}
                          labelFormatter={(label) => {
                            if (typeof label !== "string") return String(label);
                            const d = new Date(label + "T00:00:00");
                            return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                          }}
                          contentStyle={{ fontSize: 12 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                        <Line
                          type="monotone"
                          dataKey="totalOpenRate"
                          name="Total Open Rate"
                          stroke="#57a16c"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="directOpenRate"
                          name="Direct Open Rate"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          strokeDasharray="4 2"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Braze Campaign Analytics — authoritative source */}
              {data.brazeStats && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Braze Campaign</p>
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

              {/* Braze Currents counts */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Braze Currents</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-lg border p-4">
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
                </div>
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
