export const revalidate = 60;

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/charts/metric-card";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { ChartsSection } from "./charts-section";
import { LiftPanel } from "@/components/performance/lift-panel";
import { getCachedPerformanceMetrics, getCachedVariantMetrics, getCachedLiftSettings } from "@/lib/cache";
import { baselineLiftSignificance } from "@/lib/engine/lift-significance";
import { prisma } from "@/lib/db";
import { formatNumber, formatPercent } from "@/lib/utils";
import { AgentMetric, VariantMetric } from "@/types/metrics";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, Send, Zap, GitCompare } from "lucide-react";
import { AgentStatus } from "@/types/agent";
import { liftSignificance } from "@/lib/engine/lift-significance";

function LiftBadge({
  lift,
  significant,
  insufficient,
}: {
  lift: number;
  significant: boolean;
  insufficient: boolean;
}) {
  // Insufficient data: always gray, no directional signal
  if (insufficient) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground/60 text-sm" title="Fewer than 200 sends — not enough data for significance testing">
        <Minus className="h-3.5 w-3.5" />
        <span>~{lift >= 0 ? "+" : ""}{lift.toFixed(1)}%</span>
      </span>
    );
  }
  // Sufficient data but not statistically significant
  if (!significant) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-sm" title="Not statistically significant (p ≥ 0.05)">
        <Minus className="h-3.5 w-3.5" />
        {lift >= 0 ? "+" : ""}{lift.toFixed(1)}%
        <span className="text-[10px] text-muted-foreground/60">n.s.</span>
      </span>
    );
  }
  // Significant positive lift
  if (lift > 0) return (
    <span className="flex items-center gap-1 text-green-600 font-medium text-sm">
      <TrendingUp className="h-3.5 w-3.5" />+{lift.toFixed(1)}%
    </span>
  );
  // Significant negative lift
  return (
    <span className="flex items-center gap-1 text-red-500 font-medium text-sm">
      <TrendingDown className="h-3.5 w-3.5" />{lift.toFixed(1)}%
    </span>
  );
}

export default async function PerformancePage() {
  // Per-agent send/conversion counts — aggregated in the DB, not in JS
  const [
    { agents, sendsByAgent, conversionsByAgent },
    { variantSends, variantConversions, variantRewards },
    { baselineRate, liftSince },
  ] = await Promise.all([
    getCachedPerformanceMetrics(),
    getCachedVariantMetrics(),
    getCachedLiftSettings(),
  ]);

  const liftSinceFilter = liftSince ? { gte: liftSince } : undefined;
  const [liftSendsCount, liftConversionsCount] = await Promise.all([
    prisma.userDecision.count({ where: { sentAt: liftSinceFilter, reward: { not: null } } }),
    prisma.userDecision.count({ where: { sentAt: liftSinceFilter, reward: { gt: 0 } } }),
  ]);
  const nexusLift = baselineLiftSignificance(liftSendsCount, liftConversionsCount, baselineRate);

  const sendCountByAgent = new Map(sendsByAgent.map((r) => [r.agentId, r._count.id]));
  const convCountByAgent = new Map(conversionsByAgent.map((r) => [r.agentId, r._count.id]));

  const fleetSendsTotal = sendsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConversionsTotal = conversionsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConvRate = fleetSendsTotal > 0 ? (fleetConversionsTotal / fleetSendsTotal) * 100 : 0;

  const agentMetricsReal: AgentMetric[] = agents.map((a) => {
    const sends = sendCountByAgent.get(a.id) ?? 0;
    const conversions = convCountByAgent.get(a.id) ?? 0;
    const convRate = sends > 0 ? (conversions / sends) * 100 : 0;
    const { lift, significant, insufficient } = liftSignificance(
      sends, conversions, fleetSendsTotal, fleetConversionsTotal,
    );
    return {
      agentId: a.id,
      agentName: a.name,
      status: a.status,
      sends,
      conversions,
      conversionRate: convRate,
      liftVsControl: parseFloat(lift.toFixed(1)),
      liftSignificant: significant,
      liftInsufficient: insufficient,
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
            title="Nexus Lift vs Baseline"
            value={
              nexusLift.nexusSends === 0
                ? "—"
                : nexusLift.insufficient
                ? `~${nexusLift.relativeLift >= 0 ? "+" : ""}${nexusLift.relativeLift.toFixed(0)}%`
                : `${nexusLift.relativeLift >= 0 ? "+" : ""}${nexusLift.relativeLift.toFixed(0)}%`
            }
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

        {/* AI Lift vs non-Nexus baseline */}
        <LiftPanel />

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
                      <LiftBadge lift={m.liftVsControl} significant={m.liftSignificant} insufficient={m.liftInsufficient} />
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
