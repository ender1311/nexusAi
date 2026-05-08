export const revalidate = 60;

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/charts/metric-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { prisma } from "@/lib/db";
import { formatNumber, formatPercent } from "@/lib/utils";
import { TimeSeriesPoint, AgentMetric, VariantMetric, TimingHeatmapCell } from "@/types/metrics";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, Send, Zap, GitCompare } from "lucide-react";
import { AgentStatus } from "@/types/agent";

function LiftBadge({ lift }: { lift: number }) {
  if (lift > 5) return (
    <span className="flex items-center gap-1 text-green-600 font-medium text-sm">
      <TrendingUp className="h-3.5 w-3.5" />+{lift}%
    </span>
  );
  if (lift < -5) return (
    <span className="flex items-center gap-1 text-red-500 font-medium text-sm">
      <TrendingDown className="h-3.5 w-3.5" />{lift}%
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-sm">
      <Minus className="h-3.5 w-3.5" />{lift}%
    </span>
  );
}

export default async function PerformancePage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Per-agent send/conversion counts — aggregated in the DB, not in JS
  const [agents, sendsByAgent, conversionsByAgent] = await Promise.all([
    prisma.agent.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.userDecision.groupBy({
      by: ["agentId"],
      where: { sentAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    }),
    prisma.userDecision.groupBy({
      by: ["agentId"],
      where: { sentAt: { gte: thirtyDaysAgo }, conversionAt: { not: null } },
      _count: { id: true },
    }),
  ]);

  const sendCountByAgent = new Map(sendsByAgent.map((r) => [r.agentId, r._count.id]));
  const convCountByAgent = new Map(conversionsByAgent.map((r) => [r.agentId, r._count.id]));

  const fleetSendsTotal = sendsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConversionsTotal = conversionsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConvRate = fleetSendsTotal > 0 ? (fleetConversionsTotal / fleetSendsTotal) * 100 : 0;

  const agentMetricsReal: AgentMetric[] = agents.map((a) => {
    const sends = sendCountByAgent.get(a.id) ?? 0;
    const conversions = convCountByAgent.get(a.id) ?? 0;
    const convRate = sends > 0 ? (conversions / sends) * 100 : 0;
    return {
      agentId: a.id,
      agentName: a.name,
      status: a.status,
      sends,
      conversions,
      conversionRate: convRate,
      liftVsControl: sends > 0 ? parseFloat((convRate - fleetConvRate).toFixed(1)) : 0,
      exploreRatio: 0,
    };
  });

  // Lean row fetch for time-series, variant stats, and heatmap — only the columns each aggregation needs
  const timeseriesRows = await prisma.userDecision.findMany({
    where: { sentAt: { gte: thirtyDaysAgo } },
    select: { sentAt: true, conversionAt: true },
    take: 50000,
  });

  // 30-day time series
  const byDate = new Map<string, { sends: number; conversions: number }>();
  for (const d of timeseriesRows) {
    const key = d.sentAt.toISOString().slice(0, 10);
    const e = byDate.get(key) ?? { sends: 0, conversions: 0 };
    e.sends++;
    if (d.conversionAt) e.conversions++;
    byDate.set(key, e);
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

  // Top variants — aggregate sends/conversions/reward per variant in the DB, then join names
  const [variantSends, variantConversions, variantRewards] = await Promise.all([
    prisma.userDecision.groupBy({
      by: ["messageVariantId", "channel"],
      where: { sentAt: { gte: thirtyDaysAgo }, messageVariantId: { not: null } },
      _count: { id: true },
    }),
    prisma.userDecision.groupBy({
      by: ["messageVariantId"],
      where: { sentAt: { gte: thirtyDaysAgo }, messageVariantId: { not: null }, conversionAt: { not: null } },
      _count: { id: true },
    }),
    prisma.userDecision.groupBy({
      by: ["messageVariantId"],
      where: { sentAt: { gte: thirtyDaysAgo }, messageVariantId: { not: null } },
      _sum: { reward: true },
    }),
  ]);

  const variantIds = [...new Set(variantSends.map((r) => r.messageVariantId as string))];
  const variantNameRows = variantIds.length > 0
    ? await prisma.messageVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, name: true },
      })
    : [];
  const variantNameById = new Map(variantNameRows.map((v) => [v.id, v.name]));
  const convByVariant = new Map(variantConversions.map((r) => [r.messageVariantId as string, r._count.id]));
  const rewardByVariant = new Map(variantRewards.map((r) => [r.messageVariantId as string, r._sum.reward ?? 0]));

  const topVariants: VariantMetric[] = variantSends
    .map((r) => {
      const vid = r.messageVariantId as string;
      const sends = r._count.id;
      const conversions = convByVariant.get(vid) ?? 0;
      return {
        variantId: vid,
        variantName: variantNameById.get(vid) ?? vid,
        channel: r.channel,
        sends,
        conversions,
        conversionRate: sends > 0 ? (conversions / sends) * 100 : 0,
        ciLow: 0,
        ciHigh: 0,
        reward: rewardByVariant.get(vid) ?? 0,
      };
    })
    .sort((a, b) => b.sends - a.sends)
    .slice(0, 10);

  // Timing heatmap — derived from the same lean rows already fetched for time-series
  const heatmapCounts = new Map<string, number>();
  for (const d of timeseriesRows) {
    const hour = d.sentAt.getUTCHours();
    const day = d.sentAt.getUTCDay();
    const key = `${hour}:${day}`;
    heatmapCounts.set(key, (heatmapCounts.get(key) ?? 0) + 1);
  }
  const timingHeatmapData: TimingHeatmapCell[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let day = 0; day < 7; day++) {
      timingHeatmapData.push({ hour, day, value: heatmapCounts.get(`${hour}:${day}`) ?? 0 });
    }
  }

  const bestLift = agentMetricsReal.length > 0
    ? Math.max(0, ...agentMetricsReal.map((m) => m.liftVsControl))
    : 0;

  return (
    <>
      <Header title="Performance" description="Global Nexus metrics" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <MetricCard
            title="Total Sends (30d)"
            value={formatNumber(fleetSendsTotal)}
            icon={Send}
          />
          <MetricCard
            title="Avg Conv. Rate"
            value={formatPercent(fleetConvRate)}
            icon={TrendingUp}
          />
          <MetricCard
            title="Best Agent Lift"
            value={`+${bestLift.toFixed(1)}%`}
            icon={Zap}
          />
          <MetricCard
            title="Active Variants"
            value={topVariants.length}
            icon={GitCompare}
          />
        </div>

        {fleetSendsTotal === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No sends in the last 30 days. Data will appear here once agents start sending messages.</p>
            </CardContent>
          </Card>
        )}

        {/* Charts */}
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

        {/* Per-agent table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Agent Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">Agent</TableHead>
                  <TableHead className="font-semibold hidden sm:table-cell">Status</TableHead>
                  <TableHead className="text-right font-semibold">Sends</TableHead>
                  <TableHead className="text-right font-semibold hidden sm:table-cell">Conversions</TableHead>
                  <TableHead className="text-right font-semibold">Conv. Rate</TableHead>
                  <TableHead className="text-right font-semibold hidden md:table-cell">Lift vs Avg</TableHead>
                  <TableHead className="text-right font-semibold hidden md:table-cell">Explore %</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentMetricsReal.map((m) => (
                  <TableRow key={m.agentId}>
                    <TableCell className="font-medium">{m.agentName}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <AgentStatusBadge status={m.status as AgentStatus} />
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(m.sends)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{formatNumber(m.conversions)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {formatPercent(m.conversionRate)}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      <LiftBadge lift={m.liftVsControl} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground hidden md:table-cell">{m.exploreRatio}%</TableCell>
                    <TableCell>
                      <Link href={`/agents/${m.agentId}/performance`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {agentMetricsReal.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-6">
                      No agents found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>

        {/* Variant comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Top Variants (All Agents)</CardTitle>
          </CardHeader>
          <CardContent>
            <VariantComparison variants={topVariants} />
          </CardContent>
        </Card>

        {/* Timing heatmap */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Best Send Times (Discovered)</CardTitle>
          </CardHeader>
          <CardContent>
            <TimingHeatmap data={timingHeatmapData} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
