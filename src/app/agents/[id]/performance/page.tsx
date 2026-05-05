import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { ExplorationRatio } from "@/components/charts/exploration-ratio";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import { formatNumber } from "@/lib/utils";
import type { VariantMetric, TimeSeriesPoint, TimingHeatmapCell } from "@/types/metrics";

/** Wilson score 95% CI for a binomial proportion. Returns [low, high] as percentages. */
function wilsonCI(sends: number, conversions: number): { low: number; high: number } {
  if (sends === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = conversions / sends;
  const denom = 1 + (z * z) / sends;
  const center = (p + (z * z) / (2 * sends)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / sends + (z * z) / (4 * sends * sends))) / denom;
  return {
    low: Math.max(0, (center - margin) * 100),
    high: Math.min(100, (center + margin) * 100),
  };
}

export default async function AgentPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, name: true, algorithm: true, epsilon: true, status: true },
  });
  if (!agent) notFound();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const decisions = await prisma.userDecision.findMany({
    where: { agentId: id, sentAt: { gte: thirtyDaysAgo } },
    select: {
      id: true,
      sentAt: true,
      conversionAt: true,
      reward: true,
      channel: true,
      messageVariantId: true,
      variant: { select: { name: true } },
    },
    orderBy: { sentAt: "asc" },
  });

  if (decisions.length === 0) {
    return (
      <>
        <Header title="Performance" description={agent.name} />
        <div className="p-6 text-center text-muted-foreground">
          <p>No performance data yet.</p>
        </div>
      </>
    );
  }

  const sends = decisions.length;
  const conversions = decisions.filter((d) => d.conversionAt !== null).length;
  const convRate = sends > 0 ? (conversions / sends) * 100 : 0;

  // Fleet average for lift calculation (all agents, same 30-day window)
  const [fleetSends, fleetConversions] = await Promise.all([
    prisma.userDecision.count({ where: { sentAt: { gte: thirtyDaysAgo } } }),
    prisma.userDecision.count({
      where: { sentAt: { gte: thirtyDaysAgo }, conversionAt: { not: null } },
    }),
  ]);
  const fleetConvRate = fleetSends > 0 ? (fleetConversions / fleetSends) * 100 : 0;
  const lift = convRate - fleetConvRate;

  // Per-variant breakdown
  const variantMap = new Map<
    string,
    { name: string; channel: string; sends: number; conversions: number; totalReward: number }
  >();
  for (const d of decisions) {
    const vid = d.messageVariantId ?? "unknown";
    const entry = variantMap.get(vid) ?? {
      name: d.variant?.name ?? "Unknown",
      channel: d.channel,
      sends: 0,
      conversions: 0,
      totalReward: 0,
    };
    entry.sends++;
    if (d.conversionAt !== null) entry.conversions++;
    entry.totalReward += d.reward ?? 0;
    variantMap.set(vid, entry);
  }
  const variants: VariantMetric[] = [...variantMap.entries()]
    .map(([variantId, v]) => {
      const variantConvRate = v.sends > 0 ? (v.conversions / v.sends) * 100 : 0;
      const { low, high } = wilsonCI(v.sends, v.conversions);
      return {
        variantId,
        variantName: v.name,
        channel: v.channel,
        sends: v.sends,
        conversions: v.conversions,
        conversionRate: variantConvRate,
        ciLow: low,
        ciHigh: high,
        reward: v.sends > 0 ? v.totalReward / v.sends : 0,
      };
    })
    .sort((a, b) => b.conversionRate - a.conversionRate);

  // 30-day time series
  const byDate = new Map<string, { sends: number; conversions: number }>();
  for (const d of decisions) {
    const key = d.sentAt.toISOString().slice(0, 10);
    const entry = byDate.get(key) ?? { sends: 0, conversions: 0 };
    entry.sends++;
    if (d.conversionAt !== null) entry.conversions++;
    byDate.set(key, entry);
  }
  const timeSeries: TimeSeriesPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const { sends: s, conversions: c } = byDate.get(key) ?? { sends: 0, conversions: 0 };
    timeSeries.push({
      date: key,
      sends: s,
      conversions: c,
      conversionRate: s > 0 ? (c / s) * 100 : 0,
    });
  }

  // Timing heatmap: UTC hour × day of week
  const heatmapMap = new Map<string, number>();
  for (const d of decisions) {
    const hour = d.sentAt.getUTCHours();
    const day = d.sentAt.getUTCDay();
    const key = `${day}:${hour}`;
    heatmapMap.set(key, (heatmapMap.get(key) ?? 0) + 1);
  }
  const timingHeatmap: TimingHeatmapCell[] = [...heatmapMap.entries()].map(([key, value]) => {
    const [dayStr, hourStr] = key.split(":");
    return { day: parseInt(dayStr!, 10), hour: parseInt(hourStr!, 10), value };
  });

  // Exploration ratio proxy
  // - Epsilon-greedy: exactly agent.epsilon
  // - Thompson Sampling: fraction of sends going to non-best variant (natural exploration proxy)
  let explorePercent: number;
  if (agent.algorithm === "epsilon_greedy") {
    explorePercent = Math.round((agent.epsilon ?? 0.1) * 100);
  } else if (variants.length > 1) {
    const bestSends = variants[0]!.sends;
    explorePercent = Math.round(((sends - bestSends) / sends) * 100);
  } else {
    explorePercent = 100;
  }

  return (
    <>
      <Header title="Agent Performance" description={agent.name} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Sends</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(sends)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">last 30 days</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Conversions</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(conversions)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Conv. Rate</p>
              <p className="text-2xl font-bold mt-1 text-primary">{convRate.toFixed(2)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Lift vs Fleet Avg</p>
              <p
                className={`text-2xl font-bold mt-1 ${lift >= 0 ? "text-green-600" : "text-red-500"}`}
              >
                {lift >= 0 ? "+" : ""}
                {lift.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Conversion Rate Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart data={timeSeries} height={240} showSends />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Daily Send Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <DailySendsChart data={timeSeries} height={240} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {variants.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Variant Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <VariantComparison variants={variants} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Exploration Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <ExplorationRatio explorePercent={explorePercent} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Best Send Times (Discovered)</CardTitle>
          </CardHeader>
          <CardContent>
            <TimingHeatmap data={timingHeatmap} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
