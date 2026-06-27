export const revalidate = 60;
export const maxDuration = 30;

import { cache, Suspense } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/charts/metric-card";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { ChartsSection } from "./charts-section";
import { ComparisonCard } from "@/components/performance/comparison-card";
import {
  getCachedPerformanceMetrics,
  getCachedVariantMetrics,
  getCachedLiftSettings,
  getCachedLiftCounts,
  getCachedAllVariantNames,
  getCachedChartDecisions,
  getCachedPersonaVariantMatrix,
  getCachedRecoveryLeaderboard,
  getCachedFleetTransitionBreakdown,
  getCachedFleetRecoveryTrend,
} from "@/lib/cache";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { getCachedBrazeStats } from "@/lib/braze/analytics";
import { withTimeout } from "@/lib/with-timeout";
import { baselineLiftSignificance, liftSignificance } from "@/lib/engine/lift-significance";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
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
const getChartDecisions = cache(getCachedChartDecisions);
const getLiftSets = cache(getCachedLiftSettings);

// Chain: liftSettings → liftCounts, memoized so every sub-component that
// calls getLiftCounts() shares the same resolution without a duplicate query.
const LIFT_COUNTS_FALLBACK = { sendsCount: 0, conversionsCount: 0, pushSendsCount: 0, pushOpensCount: 0 };
const getLiftCounts = cache(async () => {
  const { liftSince } = await getLiftSets();
  const liftSinceDate = liftSince ? new Date(liftSince) : null;
  // 4 separate UserDecision counts — guard the cold-cache path so the KPI section
  // degrades to "—" instead of risking the 30s route timeout.
  return withTimeout(
    getCachedLiftCounts(liftSinceDate).catch(() => LIFT_COUNTS_FALLBACK),
    6000,
    LIFT_COUNTS_FALLBACK,
  );
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
    { baselineConvRate },
    { sendsCount: liftSendsCount, conversionsCount: liftConversionsCount },
  ] = await Promise.all([getPerfMetrics(), getVarMetrics(), getLiftSets(), getLiftCounts()]);

  const fleetSendsTotal = sendsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConversionsTotal = conversionsByAgent.reduce((s, r) => s + r._count.id, 0);
  const fleetConvRate = fleetSendsTotal > 0 ? (fleetConversionsTotal / fleetSendsTotal) * 100 : 0;
  const nexusLift = baselineLiftSignificance(liftSendsCount, liftConversionsCount, baselineConvRate);
  // Relative conversion-rate lift is only meaningful once a non-zero baseline is configured.
  const convBaselineSet = baselineConvRate > 0;

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
            !convBaselineSet || nexusLift.nexusSends === 0
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

async function ComparisonsSection() {
  const [
    { baselineOpenRate, baselineConvRate, liftSince },
    { sendsCount, conversionsCount, pushSendsCount, pushOpensCount },
    { rewardByDate },
  ] = await Promise.all([getLiftSets(), getLiftCounts(), getChartDecisions()]);

  const liftSinceDate = liftSince ? new Date(liftSince) : null;
  const liftSinceStr = liftSinceDate?.toISOString().slice(0, 10) ?? null;

  // Daily Nexus conversion rate sparkline (scored sends → positive conversions).
  const convSparkline = rewardByDate
    .filter((r) => !liftSinceStr || r.date >= liftSinceStr)
    .map(({ date, scored, positive }) => ({
      date,
      sends: scored,
      conversions: positive,
      conversionRate: scored > 0 ? parseFloat(((positive / scored) * 100).toFixed(2)) : 0,
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      <ComparisonCard
        title="Push Open Rate"
        nexusNumerator={pushOpensCount}
        nexusDenominator={pushSendsCount}
        baselinePct={baselineOpenRate}
        metricNoun="open rate"
        denominatorNoun="push sends"
        liftSinceDate={liftSinceDate}
        footer="Nexus rate = push opens / push sends · Baseline: configured in Settings"
      />
      <ComparisonCard
        title="Conversion Rate"
        nexusNumerator={conversionsCount}
        nexusDenominator={sendsCount}
        baselinePct={baselineConvRate}
        metricNoun="conv rate"
        denominatorNoun="scored sends"
        liftSinceDate={liftSinceDate}
        sparkline={{ data: convSparkline, label: "Daily Nexus conversion rate" }}
        footer="Nexus rate = reward > 0 / scored sends · Baseline: configured in Settings"
      />
    </div>
  );
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

async function SegmentBreakdownSection() {
  const { agents, sendsByAgent, conversionsByAgent } = await getPerfMetrics();

  // Only include agents that are in segment mode
  const segmentAgents = agents.filter((a) => a.targetSegmentName !== null);
  if (segmentAgents.length === 0) return null;

  const sendCountByAgent = new Map(sendsByAgent.map((r) => [r.agentId, r._count.id]));
  const convCountByAgent = new Map(conversionsByAgent.map((r) => [r.agentId, r._count.id]));

  // Aggregate by segment name (multiple agents could share same segment name theoretically,
  // but the uniqueness constraint means each segment maps to at most one agent)
  type SegRow = { segmentName: string; agentName: string; agentId: string; status: string; sends: number; conversions: number };
  const rows: SegRow[] = segmentAgents
    .map((a) => ({
      segmentName: a.targetSegmentName!,
      agentName: a.name,
      agentId: a.id,
      status: a.status,
      sends: sendCountByAgent.get(a.id) ?? 0,
      conversions: convCountByAgent.get(a.id) ?? 0,
    }))
    .filter((r) => r.sends > 0)
    .sort((a, b) => b.sends - a.sends);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Segment Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Segment</TableHead>
                <TableHead className="font-semibold hidden sm:table-cell">Agent</TableHead>
                <TableHead className="font-semibold hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right font-semibold">Sends</TableHead>
                <TableHead className="text-right font-semibold hidden sm:table-cell">Conversions</TableHead>
                <TableHead className="text-right font-semibold">Conv. Rate</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const convRate = r.sends > 0 ? (r.conversions / r.sends) * 100 : 0;
                return (
                  <TableRow key={r.segmentName}>
                    <TableCell className="font-mono text-xs font-medium">{r.segmentName}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">{r.agentName}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <AgentStatusBadge status={r.status as AgentStatus} />
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(r.sends)}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{formatNumber(r.conversions)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {r.conversions > 0 ? formatPercent(convRate) : <span className="text-muted-foreground font-normal">—</span>}
                    </TableCell>
                    <TableCell>
                      <Link href={`/agents/${r.agentId}/performance`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
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

  // Deduplicate sends across channels per variant, then sort by conv rate (min 10 sends)
  const sendsByVariantId = new Map<string, number>();
  for (const r of variantSends) {
    const vid = r.messageVariantId as string;
    sendsByVariantId.set(vid, (sendsByVariantId.get(vid) ?? 0) + r._count.id);
  }

  const leaderboard: VariantMetric[] = Array.from(sendsByVariantId.entries())
    .map(([vid, sends]) => {
      const conversions = convByVariant.get(vid) ?? 0;
      const channelRow = variantSends.find((r) => r.messageVariantId === vid);
      return {
        variantId: vid,
        variantName: variantNameById.get(vid) ?? vid,
        channel: channelRow?.channel ?? "unknown",
        sends,
        conversions,
        conversionRate: sends > 0 ? (conversions / sends) * 100 : 0,
        ciLow: 0,
        ciHigh: 0,
        reward: rewardByVariant.get(vid) ?? 0,
      };
    })
    .filter((v) => v.sends >= 10)
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .slice(0, 15);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Variant Leaderboard — by Conversion Rate (30d, min 10 sends)</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {leaderboard.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No variants with 10+ sends in the last 30 days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center font-semibold">#</TableHead>
                  <TableHead className="font-semibold">Variant</TableHead>
                  <TableHead className="font-semibold hidden sm:table-cell">Channel</TableHead>
                  <TableHead className="text-right font-semibold">Sends</TableHead>
                  <TableHead className="text-right font-semibold">Conversions</TableHead>
                  <TableHead className="text-right font-semibold">Conv. Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((v, i) => (
                  <TableRow key={v.variantId}>
                    <TableCell className="text-center text-xs text-muted-foreground font-mono">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                    </TableCell>
                    <TableCell className="font-medium text-sm max-w-[180px] truncate">{v.variantName}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="text-xs capitalize text-muted-foreground">{v.channel}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatNumber(v.sends)}</TableCell>
                    <TableCell className="text-right text-sm">{formatNumber(v.conversions)}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-bold text-primary">{formatPercent(v.conversionRate)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const HOUR_LABELS = [
  "12am", "1am", "2am", "3am", "4am", "5am",
  "6am",  "7am", "8am", "9am", "10am","11am",
  "12pm", "1pm", "2pm", "3pm", "4pm", "5pm",
  "6pm",  "7pm", "8pm", "9pm", "10pm","11pm",
];

async function SendTimeSection() {
  const { hourly } = await getChartDecisions();
  if (hourly.length === 0) return null;

  const maxSends = Math.max(...hourly.map((h) => h.sends), 1);
  const maxConvRate = Math.max(...hourly.filter((h) => h.sends >= 10).map((h) => h.convRate), 0.01);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Send-Time Intelligence — Hour of Day (30d local)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {hourly.map((row) => {
            const sendBar = (row.sends / maxSends) * 100;
            const convBar = row.sends >= 10 ? (row.convRate / maxConvRate) * 100 : 0;
            return (
              <div key={row.hour} className="flex items-center gap-2 group">
                <span className="text-xs text-muted-foreground w-10 shrink-0 text-right">
                  {HOUR_LABELS[row.hour]}
                </span>
                <div className="relative flex-1 h-5 rounded overflow-hidden bg-muted/30">
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/20 transition-all"
                    style={{ width: `${sendBar}%` }}
                  />
                  {convBar > 0 && (
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/60 transition-all"
                      style={{ width: `${convBar}%` }}
                      title={`Conv rate: ${row.convRate.toFixed(1)}%`}
                    />
                  )}
                </div>
                <span className="text-xs text-muted-foreground w-14 shrink-0 text-right font-mono">
                  {formatNumber(row.sends)}
                </span>
                <span
                  className={cn(
                    "text-xs w-14 shrink-0 text-right font-mono",
                    row.sends >= 10 ? "text-primary font-medium" : "text-muted-foreground/40",
                  )}
                >
                  {row.sends >= 10 ? `${row.convRate.toFixed(1)}%` : "—"}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t">
            <span className="text-xs text-muted-foreground w-10 shrink-0" />
            <div className="flex gap-3 flex-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-primary/20 inline-block" />
                Sends volume
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-primary/60 inline-block" />
                Conv. rate (relative, min 10 sends)
              </span>
            </div>
            <span className="text-xs text-muted-foreground w-14 text-right">Sends</span>
            <span className="text-xs text-muted-foreground w-14 text-right">Conv %</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const PERSONA_MATRIX_FALLBACK = {
  personaIds: [] as string[],
  variantIds: [] as string[],
  personaLabels: [] as string[],
  variantNames: [] as string[],
  cells: [] as Awaited<ReturnType<typeof getCachedPersonaVariantMatrix>>["cells"],
};

async function PersonaMatrixSection() {
  const { personaIds, variantIds, personaLabels, variantNames, cells } = await withTimeout(
    getCachedPersonaVariantMatrix().catch(() => PERSONA_MATRIX_FALLBACK),
    6000,
    PERSONA_MATRIX_FALLBACK,
  );

  if (personaIds.length === 0 || variantIds.length === 0) return null;

  const cellMap = new Map(
    cells.map((c) => [`${c.personaId}:${c.variantId}`, c]),
  );

  // Find global max convRate for relative shading
  let maxConvRate = 0.01;
  for (const c of cells) {
    const rate = c.tries > 1 ? Math.max(0, (c.alpha - 1) / c.tries) : 0;
    if (rate > maxConvRate) maxConvRate = rate;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Persona × Variant — Win Rates</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground min-w-[90px]">Persona</th>
                {variantNames.map((name, i) => (
                  <th
                    key={variantIds[i]}
                    className="py-1.5 px-1 font-medium text-muted-foreground text-center max-w-[80px] min-w-[60px]"
                  >
                    <span className="block truncate" title={name}>{name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personaIds.map((pId, pi) => (
                <tr key={pId} className="border-t border-border/40">
                  <td className="py-1.5 pr-3 font-medium truncate max-w-[90px]" title={personaLabels[pi]}>
                    {personaLabels[pi]}
                  </td>
                  {variantIds.map((vId) => {
                    const cell = cellMap.get(`${pId}:${vId}`);
                    if (!cell || cell.tries < 2) {
                      return (
                        <td key={vId} className="py-1.5 px-1 text-center text-muted-foreground/30">
                          —
                        </td>
                      );
                    }
                    const convRate = Math.max(0, (cell.alpha - 1) / cell.tries);
                    const intensity = convRate / maxConvRate;
                    const pct = (convRate * 100).toFixed(1);
                    return (
                      <td
                        key={vId}
                        className="py-1.5 px-1 text-center"
                        title={`${pct}% conv rate (${cell.tries} tries)`}
                      >
                        <span
                          className="inline-block rounded px-1.5 py-0.5 font-mono font-medium"
                          style={{
                            backgroundColor: `rgba(99,102,241,${Math.min(0.08 + intensity * 0.55, 0.65)})`,
                            color: intensity > 0.6 ? "rgb(67,56,202)" : undefined,
                          }}
                        >
                          {pct}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Conv rate per persona–variant pair from arm learning data. Darker = higher rate. Min 2 tries shown.
        </p>
      </CardContent>
    </Card>
  );
}

async function ReengagementSection() {
  const [leaderboard, breakdown, trend] = await Promise.all([
    getCachedRecoveryLeaderboard().catch(() => []),
    getCachedFleetTransitionBreakdown().catch(() => []),
    getCachedFleetRecoveryTrend().catch(() => []),
  ]);
  if (leaderboard.length === 0 && breakdown.length === 0) return null;

  const trendSeries = trend.map((t) => ({ date: t.date, sends: t.recoveries, conversions: 0, conversionRate: 0 }));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Re-engagement (fleet)</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Recovery Leaderboard</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Agent</th>
                  <th className="text-right px-4 py-2 font-medium">Recoveries</th>
                  <th className="text-right px-4 py-2 font-medium">Reward</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.agentId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{row.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(row.recoveries)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{row.reward.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Fleet Recovery Trend</CardTitle></CardHeader>
          <CardContent><TimeSeriesChart data={trendSeries} height={240} showSends /></CardContent>
        </Card>
      </div>
      {breakdown.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Fleet Recoveries by Transition</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">From → To</th>
                  <th className="text-right px-4 py-2 font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.label} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{r.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatNumber(r.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
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
  void getChartDecisions();
  void getCachedPersonaVariantMatrix();

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

        <Suspense fallback={
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        }>
          <ComparisonsSection />
        </Suspense>

        {/* Charts stream independently — already wrapped in Suspense */}
        <ChartsSection />

        <Suspense fallback={<TableSkeleton />}>
          <AgentTableSection />
        </Suspense>

        <Suspense fallback={<TableSkeleton />}>
          <ReengagementSection />
        </Suspense>

        <Suspense fallback={<TableSkeleton />}>
          <SegmentBreakdownSection />
        </Suspense>

        <Suspense fallback={<VariantSkeleton />}>
          <TopVariantsSection />
        </Suspense>

        <Suspense fallback={<TableSkeleton />}>
          <SendTimeSection />
        </Suspense>

        <Suspense fallback={<TableSkeleton />}>
          <PersonaMatrixSection />
        </Suspense>
      </div>
    </>
  );
}
