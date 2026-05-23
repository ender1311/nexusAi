export const revalidate = 60;
export const maxDuration = 30;

import { cache, Suspense } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/charts/metric-card";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { ChartsSection } from "./charts-section";
import { LiftPanel } from "@/components/performance/lift-panel";
import {
  getCachedPerformanceMetrics,
  getCachedVariantMetrics,
  getCachedLiftSettings,
  getCachedLiftCounts,
  getCachedAllVariantNames,
  getCachedBrazeStats,
} from "@/lib/cache";
import { baselineLiftSignificance, liftSignificance } from "@/lib/engine/lift-significance";
import { formatNumber, formatPercent } from "@/lib/utils";
import type { AgentMetric, VariantMetric } from "@/types/metrics";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, Send, Zap, GitCompare } from "lucide-react";
import { PushOpenRateCard } from "@/components/metrics/push-open-rate-card";
import type { AgentStatus } from "@/types/agent";

// ── Request-level deduplication ───────────────────────────────────────────────
// React.cache() ensures sub-components sharing these fetches don't race
// each other in the same render pass — only one DB round-trip per request.
const getPerfMetrics = cache(getCachedPerformanceMetrics);
const getVarMetrics = cache(getCachedVariantMetrics);
const getLiftSets = cache(getCachedLiftSettings);

// Chain: liftSettings → liftCounts, memoized so every sub-component that
// calls getLiftCounts() shares the same resolution without a duplicate query.
const getLiftCounts = cache(async () => {
  const { liftSince } = await getLiftSets();
  const liftSinceDate = liftSince ? new Date(liftSince as unknown as string) : null;
  return getCachedLiftCounts(liftSinceDate);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function LiftBadge({
  lift,
  significant,
  insufficient,
}: {
  lift: number;
  significant: boolean;
  insufficient: boolean;
}) {
  if (insufficient) {
    return (
      <span
        className="flex items-center gap-1 text-muted-foreground/60 text-sm"
        title="Fewer than 200 sends — not enough data for significance testing"
      >
        <Minus className="h-3.5 w-3.5" />
        <span>~{lift >= 0 ? "+" : ""}{lift.toFixed(1)}%</span>
      </span>
    );
  }
  if (!significant) {
    return (
      <span
        className="flex items-center gap-1 text-muted-foreground text-sm"
        title="Not statistically significant (p ≥ 0.05)"
      >
        <Minus className="h-3.5 w-3.5" />
        {lift >= 0 ? "+" : ""}{lift.toFixed(1)}%
        <span className="text-[10px] text-muted-foreground/60">n.s.</span>
      </span>
    );
  }
  if (lift > 0) {
    return (
      <span className="flex items-center gap-1 text-green-600 font-medium text-sm">
        <TrendingUp className="h-3.5 w-3.5" />+{lift.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-red-500 font-medium text-sm">
      <TrendingDown className="h-3.5 w-3.5" />{lift.toFixed(1)}%
    </span>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function MetricCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VariantSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full rounded" />
      </CardContent>
    </Card>
  );
}

// ── Async sub-components ──────────────────────────────────────────────────────

async function KPIsSection() {
  const [
    { sendsByAgent, conversionsByAgent },
    { variantSends },
    { baselineRate },
    { sendsCount: liftSendsCount, conversionsCount: liftConversionsCount },
  ] = await Promise.all([getPerfMetrics(), getVarMetrics(), getLiftSets(), getLiftCounts()]);

  const fleetSendsTotal = sendsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConversionsTotal = conversionsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConvRate = fleetSendsTotal > 0 ? (fleetConversionsTotal / fleetSendsTotal) * 100 : 0;
  const nexusLift = baselineLiftSignificance(liftSendsCount, liftConversionsCount, baselineRate);

  return (
    <>
      <MetricCard title="Total Sends (30d)" value={formatNumber(fleetSendsTotal)} icon={Send} />
      {fleetConversionsTotal > 0 && (
        <MetricCard title="Avg Conv. Rate" value={formatPercent(fleetConvRate)} icon={TrendingUp} />
      )}
      {fleetConversionsTotal > 0 && (
        <MetricCard
          title="Nexus Lift vs Baseline"
          value={
            nexusLift.nexusSends === 0
              ? "—"
              : `${nexusLift.relativeLift >= 0 ? "+" : ""}${nexusLift.relativeLift.toFixed(0)}%`
          }
          icon={Zap}
        />
      )}
      <MetricCard title="Active Variants" value={variantSends.length} icon={GitCompare} />
    </>
  );
}

async function PushOpenRateSection() {
  const [{ pushSendsByAgent, pushOpensByAgent }, brazeStats] = await Promise.all([
    getPerfMetrics(),
    getCachedBrazeStats().catch(() => null),
  ]);
  const fleetPushSendsTotal = pushSendsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetPushOpensTotal = pushOpensByAgent.reduce((s, r) => s + r._count.id, 0);
  const dbPushOpenRate =
    fleetPushSendsTotal > 0 ? (fleetPushOpensTotal / fleetPushSendsTotal) * 100 : 0;
  const fleetPushOpenRate = Math.max(dbPushOpenRate, brazeStats?.directOpenRate ?? 0);
  return (
    <PushOpenRateCard
      title="Avg Push Open Rate"
      value={fleetPushSendsTotal > 0 || brazeStats ? formatPercent(fleetPushOpenRate) : "—"}
    />
  );
}

async function LiftPanelSection() {
  const { sendsCount, conversionsCount } = await getLiftCounts();
  return <LiftPanel nexusSendsCount={sendsCount} nexusConversionsCount={conversionsCount} />;
}

async function AgentTableSection() {
  const { agents, sendsByAgent, conversionsByAgent, pushSendsByAgent, pushOpensByAgent } =
    await getPerfMetrics();

  const sendCountByAgent = new Map(sendsByAgent.map((r) => [r.agentId, r._count.id]));
  const convCountByAgent = new Map(conversionsByAgent.map((r) => [r.agentId, r._count.id]));
  const pushSendCountByAgent = new Map(pushSendsByAgent.map((r) => [r.agentId, r._count.id]));
  const pushOpenCountByAgent = new Map(pushOpensByAgent.map((r) => [r.agentId, r._count.id]));

  const fleetSendsTotal = sendsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConversionsTotal = conversionsByAgent.reduce((s, r) => s + r._count.id, 0);

  const agentMetrics: AgentMetric[] = agents.map((a) => {
    const sends = sendCountByAgent.get(a.id) ?? 0;
    const conversions = convCountByAgent.get(a.id) ?? 0;
    const convRate = sends > 0 ? (conversions / sends) * 100 : 0;
    const { lift, significant, insufficient } = liftSignificance(
      sends,
      conversions,
      fleetSendsTotal,
      fleetConversionsTotal,
    );
    const agentPushSends = pushSendCountByAgent.get(a.id) ?? 0;
    const agentPushOpens = pushOpenCountByAgent.get(a.id) ?? 0;
    const agentPushOpenRate = agentPushSends > 0 ? (agentPushOpens / agentPushSends) * 100 : 0;
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
      pushSends: agentPushSends,
      pushOpenRate: agentPushOpenRate,
    };
  });

  return (
    <>
      {fleetSendsTotal === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No sends in the last 30 days. Data will appear here once agents start sending messages.
            </p>
          </CardContent>
        </Card>
      )}
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
                  <TableHead className="text-right font-semibold hidden md:table-cell">Push Open %</TableHead>
                  <TableHead className="text-right font-semibold hidden md:table-cell">Lift vs Avg</TableHead>
                  <TableHead className="text-right font-semibold hidden md:table-cell">Explore %</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentMetrics.map((m) => (
                  <TableRow key={m.agentId}>
                    <TableCell className="font-medium">{m.agentName}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <AgentStatusBadge status={m.status as AgentStatus} />
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(m.sends)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {formatNumber(m.conversions)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {formatPercent(m.conversionRate)}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {m.pushSends && m.pushSends > 0 ? (
                        <span className="font-medium text-primary">{m.pushOpenRate?.toFixed(1)}%</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      <LiftBadge
                        lift={m.liftVsControl}
                        significant={m.liftSignificant}
                        insufficient={m.liftInsufficient}
                      />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground hidden md:table-cell">
                      {m.exploreRatio}%
                    </TableCell>
                    <TableCell>
                      <Link href={`/agents/${m.agentId}/performance`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {agentMetrics.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground text-sm py-6"
                    >
                      No agents found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

async function TopVariantsSection() {
  const [{ variantSends, variantConversions, variantRewards }, allVariantNames] = await Promise.all([
    getVarMetrics(),
    getCachedAllVariantNames(),
  ]);

  const variantNameById = new Map(allVariantNames.map((v) => [v.id, v.name]));
  const convByVariant = new Map(
    variantConversions.map((r) => [r.messageVariantId as string, r._count.id]),
  );
  const rewardByVariant = new Map(
    variantRewards.map((r) => [r.messageVariantId as string, r._sum.reward ?? 0]),
  );

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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Top Variants (All Agents)</CardTitle>
      </CardHeader>
      <CardContent>
        <VariantComparison variants={topVariants} />
      </CardContent>
    </Card>
  );
}

// ── Page shell — synchronous, header paints at ~0ms ──────────────────────────

export default function PerformancePage() {
  // Pre-kick all fetches so React.cache() deduplication can share them
  // across sub-components before those components even mount.
  void getPerfMetrics();
  void getVarMetrics();
  void getLiftSets();
  void getCachedBrazeStats();
  void getCachedAllVariantNames();
  void getLiftCounts();

  return (
    <>
      <Header title="Performance" description="Global Nexus metrics" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* KPI row — two Suspense boundaries inside the same grid so Braze is isolated.
            React renders Suspense without a DOM wrapper, so the Fragment children of
            KPIsSection become direct grid items alongside PushOpenRateSection. */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <Suspense
            fallback={
              <>
                {[1, 2, 3, 4].map((i) => (
                  <MetricCardSkeleton key={i} />
                ))}
              </>
            }
          >
            <KPIsSection />
          </Suspense>
          <Suspense fallback={<MetricCardSkeleton />}>
            <PushOpenRateSection />
          </Suspense>
        </div>

        <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
          <LiftPanelSection />
        </Suspense>

        {/* Charts stream independently — already wrapped in Suspense */}
        <ChartsSection />

        <Suspense fallback={<TableSkeleton />}>
          <AgentTableSection />
        </Suspense>

        <Suspense fallback={<VariantSkeleton />}>
          <TopVariantsSection />
        </Suspense>
      </div>
    </>
  );
}
