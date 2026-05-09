export const revalidate = 60;

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/charts/metric-card";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { ChartsSection } from "./charts-section";
import { getCachedPerformanceMetrics, getCachedVariantMetrics } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { formatNumber, formatPercent } from "@/lib/utils";
import { AgentMetric, VariantMetric } from "@/types/metrics";
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
  // Per-agent send/conversion counts — aggregated in the DB, not in JS
  const [{ agents, sendsByAgent, conversionsByAgent }, { variantSends, variantConversions, variantRewards }] = await Promise.all([
    getCachedPerformanceMetrics(),
    getCachedVariantMetrics(),
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


  // Top variants — variant name lookup joined after cache fetch

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

        {/* Charts — streamed in via Suspense to unblock KPIs and agent table */}
        <ChartsSection />

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

      </div>
    </>
  );
}
