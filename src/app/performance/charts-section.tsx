import { Suspense } from "react";
import { getCachedChartDecisions } from "@/lib/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import type { TimeSeriesPoint, TimingHeatmapCell } from "@/types/metrics";

async function Charts() {
  const now = new Date();

  const rows = await getCachedChartDecisions();

  // Single pass: build both byDate (time series) and heatmapCounts simultaneously.
  // rows contain ISO date strings (pre-serialized in cache to survive JSON round-trip).
  const byDate = new Map<string, { sends: number; conversions: number }>();
  const heatmapCounts = new Map<string, number>();
  for (const d of rows) {
    const dateKey = d.sentAt.slice(0, 10); // "YYYY-MM-DD" — no Date object needed
    const entry = byDate.get(dateKey) ?? { sends: 0, conversions: 0 };
    entry.sends++;
    if (d.conversionAt) entry.conversions++;
    byDate.set(dateKey, entry);

    const sentAt = new Date(d.sentAt);
    const hKey = `${sentAt.getUTCHours()}:${sentAt.getUTCDay()}`;
    heatmapCounts.set(hKey, (heatmapCounts.get(hKey) ?? 0) + 1);
  }

  const last30Days: TimeSeriesPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const { sends, conversions } = byDate.get(key) ?? { sends: 0, conversions: 0 };
    last30Days.push({ date: key, sends, conversions, conversionRate: sends > 0 ? (conversions / sends) * 100 : 0 });
  }
  const last7Days = last30Days.slice(-7);
  const timingHeatmapData: TimingHeatmapCell[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let day = 0; day < 7; day++) {
      timingHeatmapData.push({ hour, day, value: heatmapCounts.get(`${hour}:${day}`) ?? 0 });
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Conversion Rate Trend (30 days)</CardTitle>
            <Badge variant="outline" className="text-xs">All Agents</Badge>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart data={last30Days} height={240} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Daily Send Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <DailySendsChart data={last7Days} height={240} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Best Send Times (Discovered)</CardTitle>
        </CardHeader>
        <CardContent>
          <TimingHeatmap data={timingHeatmapData} />
        </CardContent>
      </Card>
    </>
  );
}

function ChartsFallback() {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </>
  );
}

export function ChartsSection() {
  return (
    <Suspense fallback={<ChartsFallback />}>
      <Charts />
    </Suspense>
  );
}
