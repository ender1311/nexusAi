export const revalidate = 900;
export const maxDuration = 30;

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { prisma } from "@/lib/db";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { ExplorationRatio } from "@/components/charts/exploration-ratio";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import { formatNumber } from "@/lib/utils";
import type { VariantMetric, TimeSeriesPoint, TimingHeatmapCell } from "@/types/metrics";
import { liftSignificance } from "@/lib/engine/lift-significance";
import { agentGiftMetrics } from "@/lib/cache/agent-gift-metrics";
import { AgentCohortGiving } from "@/components/agents/agent-cohort-giving";
import { withTimeout } from "@/lib/with-timeout";

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

function PerformanceSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border bg-muted animate-pulse h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

async function PerformanceContent({ id }: { id: string }) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Phase 1: all three independent queries in parallel (saves 2 DB round-trips vs sequential)
  const [agent, armStats, decisions, giftGoal] = await Promise.all([
    prisma.agent.findUnique({
      where: { id },
      select: { id: true, name: true, algorithm: true, epsilon: true, status: true },
    }),
    prisma.personaArmStats.findMany({
      where: { agentId: id },
      select: { personaId: true, variantId: true, alpha: true, beta: true, tries: true, wins: true },
    }),
    prisma.userDecision.findMany({
      where: { agentId: id, sentAt: { gte: thirtyDaysAgo } },
      select: {
        id: true,
        userId: true,
        sentAt: true,
        conversionAt: true,
        conversionEvent: true,
        conversionValue: true,
        pushOpenAt: true,
        reward: true,
        channel: true,
        scheduledFor: true,
        brazeSendId: true,
        messageVariantId: true,
      },
      orderBy: { sentAt: "asc" },
      // Safety cap: prevents unbounded memory growth for high-volume agents.
      // At typical send rates this window holds well under 5 000 rows.
      take: 5000,
    }),
    prisma.goal.findFirst({ where: { agentId: id, eventName: "gift_given" }, select: { id: true } }),
  ]);

  if (!agent) return null; // page-level notFound already fired

  if (decisions.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>No performance data yet.</p>
      </div>
    );
  }

  // Phase 2: dependent lookups — all run in parallel
  const uniquePersonaIds = [...new Set(armStats.map((a) => a.personaId))];
  const uniqueVariantIds = [...new Set(armStats.map((a) => a.variantId))];
  const decidedVariantIds = [...new Set(decisions.map((d) => d.messageVariantId).filter((v): v is string => v !== null))];

  // Single raw query replaces two separate count() calls — one index scan instead of two
  const [personaRows, variantRows, variantNameRows, fleetAgg] = await Promise.all([
    uniquePersonaIds.length > 0
      ? prisma.persona.findMany({
          where: { id: { in: uniquePersonaIds } },
          select: { id: true, name: true, color: true },
        })
      : Promise.resolve([]),
    uniqueVariantIds.length > 0
      ? prisma.messageVariant.findMany({
          where: { id: { in: uniqueVariantIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    decidedVariantIds.length > 0
      ? prisma.messageVariant.findMany({
          where: { id: { in: decidedVariantIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Fleet-wide COUNT over 30d of UserDecision (~35M rows, only a sentAt index).
    // Bounded so a cold-cache recompute renders a fallback instead of 504ing the
    // whole performance tab (single Suspense boundary).
    withTimeout(
      prisma.$queryRaw<[{ fleet_sends: bigint; fleet_conversions: bigint }]>`
        SELECT COUNT(*)::bigint AS fleet_sends, COUNT("conversionAt")::bigint AS fleet_conversions
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
      `,
      6000,
      [{ fleet_sends: BigInt(0), fleet_conversions: BigInt(0) }] as [{ fleet_sends: bigint; fleet_conversions: bigint }],
    ),
  ]);

  // ── Re-engagement (spec C1) ──
  const [recoveryTransitions, ownedCount, recoveryRewardAgg, lapsedOwnedInWindow] = await Promise.all([
    prisma.funnelTransition.findMany({
      where: { attributedAgentId: id, detectedAt: { gte: thirtyDaysAgo } },
      select: { fromStage: true, toStage: true, detectedAt: true },
      orderBy: { detectedAt: "asc" },
      take: 5000,
    }),
    prisma.userAgentAssignment.count({ where: { agentId: id, releasedAt: null } }),
    prisma.userDecision.aggregate({
      where: { agentId: id, conversionEvent: "funnel_recovery", conversionAt: { gte: thirtyDaysAgo } },
      _sum: { reward: true },
    }),
    prisma.userAgentAssignment.count({ where: { agentId: id, startedAt: { gte: thirtyDaysAgo } } }),
  ]);

  const giftMetrics = await agentGiftMetrics(id);

  const recoveries30d = recoveryTransitions.length;
  const recoveryReward = recoveryRewardAgg._sum.reward ?? 0;
  const recoveryRate = lapsedOwnedInWindow > 0 ? (recoveries30d / lapsedOwnedInWindow) * 100 : 0;

  const transitionMap = new Map<string, number>();
  for (const t of recoveryTransitions) {
    const key = `${t.fromStage}→${t.toStage}`;
    transitionMap.set(key, (transitionMap.get(key) ?? 0) + 1);
  }
  const transitionRows = [...transitionMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const recoveryByDate = new Map<string, number>();
  for (const t of recoveryTransitions) {
    const key = t.detectedAt.toISOString().slice(0, 10);
    recoveryByDate.set(key, (recoveryByDate.get(key) ?? 0) + 1);
  }
  const recoveryTrend: TimeSeriesPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    recoveryTrend.push({
      date: key,
      sends: recoveryByDate.get(key) ?? 0,
      conversions: 0,
      conversionRate: 0,
    });
  }

  const fleetSends = Number(fleetAgg[0]?.fleet_sends ?? 0);
  const fleetConversions = Number(fleetAgg[0]?.fleet_conversions ?? 0);

  const personaById = new Map(personaRows.map((p) => [p.id, p]));
  const variantById = new Map(variantRows.map((v) => [v.id, v]));
  const variantNameById = new Map(variantNameRows.map((v) => [v.id, v.name]));

  // ── Giving attribution: which push variant drove how much revenue, plus the
  //    user-level attributed gifts (30-day window, same as the rest of this tab) ──
  const hasGiftGoal = giftGoal !== null;
  const giftDecisions = decisions.filter((d) => d.conversionEvent === "gift_given");
  const variantLabel = (vid: string | null) =>
    vid ? variantNameById.get(vid) ?? "Unknown variant" : "(no variant)";
  const giftByVariant = new Map<string, { name: string; gifts: number; revenue: number }>();
  for (const d of giftDecisions) {
    const key = d.messageVariantId ?? "—";
    const e = giftByVariant.get(key) ?? { name: variantLabel(d.messageVariantId), gifts: 0, revenue: 0 };
    e.gifts++;
    e.revenue += d.conversionValue ?? 0;
    giftByVariant.set(key, e);
  }
  const giftVariantRows = [...giftByVariant.values()].sort((a, b) => b.revenue - a.revenue);
  const giftTotalRevenue = giftVariantRows.reduce((s, r) => s + r.revenue, 0);
  const recentGifts = giftDecisions
    .filter((d) => d.conversionAt !== null)
    .sort((a, b) => b.conversionAt!.getTime() - a.conversionAt!.getTime())
    .slice(0, 40)
    .map((d) => ({
      userId: d.userId,
      variantName: variantLabel(d.messageVariantId),
      usd: d.conversionValue ?? 0,
      giftAt: d.conversionAt!,
    }));

  type PersonaBreakdownRow = {
    personaId: string;
    name: string;
    color: string;
    tries: number;
    wins: number;
    convRate: number;
    bestVariantName: string | null;
    bestVariantMean: number;
  };
  const personaBreakdown: PersonaBreakdownRow[] = [];
  const byPersona = new Map<string, typeof armStats>();
  for (const arm of armStats) {
    const arr = byPersona.get(arm.personaId) ?? [];
    arr.push(arm);
    byPersona.set(arm.personaId, arr);
  }
  for (const [pid, arms] of byPersona) {
    const totalTries = arms.reduce((s, a) => s + a.tries, 0);
    const totalWins = arms.reduce((s, a) => s + a.wins, 0);
    const bestArm = arms.reduce(
      (best, a) => {
        const mean = a.alpha / (a.alpha + a.beta);
        return mean > best.mean ? { mean, variantId: a.variantId } : best;
      },
      { mean: -1, variantId: "" },
    );
    const persona = personaById.get(pid);
    personaBreakdown.push({
      personaId: pid,
      name: persona?.name ?? pid,
      color: persona?.color ?? "gray",
      tries: totalTries,
      wins: totalWins,
      convRate: totalTries > 0 ? (totalWins / totalTries) * 100 : 0,
      bestVariantName: variantById.get(bestArm.variantId)?.name ?? null,
      bestVariantMean: bestArm.mean,
    });
  }
  personaBreakdown.sort((a, b) => b.convRate - a.convRate);

  const sends = decisions.length;
  const conversions = decisions.filter((d) => d.conversionAt !== null).length;
  const convRate = sends > 0 ? (conversions / sends) * 100 : 0;
  // "Delivered" for open-rate purposes means Braze actually accepted the send
  // (brazeSendId set — sentAt defaults to now() at insert so it can't be trusted)
  // AND the delivery time has passed (a future-scheduled in_local_time send gets a
  // brazeSendId at scheduling time but can't have an open yet). Counting either
  // phantom/unsent rows or still-pending rows deflates the open rate.
  const isDelivered = (d: { scheduledFor: Date | null; brazeSendId: string | null }) =>
    d.brazeSendId !== null && (d.scheduledFor === null || d.scheduledFor <= now);
  const pushSends = decisions.filter((d) => d.channel === "push" && isDelivered(d)).length;
  const pushOpens = decisions.filter((d) => d.channel === "push" && d.pushOpenAt !== null).length;
  const pushOpenRate = pushSends > 0 ? (pushOpens / pushSends) * 100 : 0;
  const { lift, significant: liftSignificant, insufficient: liftInsufficient } = liftSignificance(
    sends, conversions, fleetSends, fleetConversions,
  );

  // Per-variant breakdown
  const variantMap = new Map<
    string,
    { name: string; channel: string; sends: number; conversions: number; totalReward: number }
  >();
  for (const d of decisions) {
    const vid = d.messageVariantId ?? "unknown";
    const entry = variantMap.get(vid) ?? {
      name: (d.messageVariantId ? variantNameById.get(d.messageVariantId) : undefined) ?? "Unknown",
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
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className={`grid gap-3 sm:gap-4 ${pushSends > 0 ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"}`}>
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
              className={`text-2xl font-bold mt-1 ${
                liftInsufficient || !liftSignificant
                  ? "text-muted-foreground"
                  : lift >= 0
                  ? "text-green-600"
                  : "text-red-500"
              }`}
            >
              {liftInsufficient ? "~" : ""}{lift >= 0 ? "+" : ""}{lift.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              {liftInsufficient
                ? `Need ${200 - sends} more sends`
                : liftSignificant
                ? "p < 0.05 · significant"
                : "n.s. · p ≥ 0.05"}
            </p>
          </CardContent>
        </Card>
        {pushSends > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Push Open Rate</p>
              <p className="text-2xl font-bold mt-1 text-primary">{pushOpenRate.toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatNumber(pushOpens)} of {formatNumber(pushSends)} push</p>
            </CardContent>
          </Card>
        )}
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

      {(recoveries30d > 0 || ownedCount > 0) && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Re-engagement (lapsed → active)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Recoveries</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(recoveries30d)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">last 30 days</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Recovery Rate</p>
              <p className="text-2xl font-bold mt-1 text-primary">{recoveryRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-0.5">of users owned (30d)</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Reward from Recoveries</p>
              <p className="text-2xl font-bold mt-1">{recoveryReward.toFixed(2)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Currently Owned</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(ownedCount)}</p>
            </CardContent></Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Recovery Trend</CardTitle></CardHeader>
              <CardContent><TimeSeriesChart data={recoveryTrend} height={240} showSends /></CardContent>
            </Card>
            {transitionRows.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Recoveries by Transition</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-medium">From → To</th>
                        <th className="text-right px-4 py-2 font-medium">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transitionRows.map((r) => (
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
        </div>
      )}

      {(hasGiftGoal || giftMetrics.giftCount > 0 || giftMetrics.sowerCount > 0) && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Gifts driven · last 30 days</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Gifts</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(giftMetrics.giftCount)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">attributed conversions</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Gift Revenue</p>
              <p className="text-2xl font-bold mt-1 text-primary">${formatNumber(Math.round(giftTotalRevenue))}</p>
              <p className="text-xs text-muted-foreground mt-0.5">USD, summed across variants</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Gift Conversion Rate</p>
              <p className="text-2xl font-bold mt-1">{giftMetrics.giftConversionRate.toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-0.5">gifts ÷ sends</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Avg Time to Gift</p>
              <p className="text-2xl font-bold mt-1">{giftMetrics.avgTimeToGiftHours > 0 ? `${giftMetrics.avgTimeToGiftHours.toFixed(1)}h` : "—"}</p>
            </CardContent></Card>
          </div>

          {giftMetrics.sowerCount > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Recurring givers (Sowers)</p>
                <p className="text-2xl font-bold mt-1 text-primary">{formatNumber(giftMetrics.sowerCount)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">recurring subscriptions</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Sower Conversion Rate</p>
                <p className="text-2xl font-bold mt-1">{giftMetrics.sowerConversionRate.toFixed(2)}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">sowers ÷ sends</p>
              </CardContent></Card>
            </div>
          )}

          {/* Per-variant revenue attribution — which push message drove how much */}
          {giftVariantRows.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Revenue by message variant</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Variant</th>
                      <th className="text-right px-4 py-2 font-medium">Gifts</th>
                      <th className="text-right px-4 py-2 font-medium">Revenue</th>
                      <th className="text-right px-4 py-2 font-medium">% of revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {giftVariantRows.map((r) => (
                      <tr key={r.name} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium">{r.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatNumber(r.gifts)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">${formatNumber(Math.round(r.revenue))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {giftTotalRevenue > 0 ? `${((r.revenue / giftTotalRevenue) * 100).toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(giftMetrics.giftCount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-primary">${formatNumber(Math.round(giftTotalRevenue))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">100%</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">No gifts attributed in the last 30 days yet.</p>
          )}

          {/* User-level attributed gifts */}
          {recentGifts.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Attributed gifts (user level)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">User</th>
                      <th className="text-left px-4 py-2 font-medium">Variant</th>
                      <th className="text-right px-4 py-2 font-medium">Amount</th>
                      <th className="text-right px-4 py-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentGifts.map((g, i) => (
                      <tr key={`${g.userId}-${i}`} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-mono text-xs">{g.userId}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{g.variantName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">${g.usd.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-xs">
                          {g.giftAt.toISOString().slice(0, 10)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {personaBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Per-Persona Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Persona</th>
                  <th className="text-right px-4 py-2 font-medium">Sends</th>
                  <th className="text-right px-4 py-2 font-medium">Conv. Rate</th>
                  <th className="text-left px-4 py-2 font-medium">Leading Variant</th>
                </tr>
              </thead>
              <tbody>
                {personaBreakdown.map((row) => (
                  <tr key={row.personaId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 bg-${row.color}-500`}
                        />
                        <span className="font-medium">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatNumber(row.tries)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={row.convRate >= convRate ? "text-green-600 font-medium" : "text-muted-foreground"}>
                        {row.convRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.bestVariantName ? (
                        <span className="text-xs">
                          {row.bestVariantName}
                          <span className="ml-1.5 text-muted-foreground/60">
                            ({(row.bestVariantMean * 100).toFixed(0)}% est.)
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
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

export default async function AgentPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Quick cached lookup for header — all heavy queries happen inside the Suspense boundary.
  const agentMeta = await unstable_cache(
    () => prisma.agent.findUnique({ where: { id }, select: { name: true } }),
    ["agent-perf-header", id],
    { tags: [`agent-${id}`], revalidate: 900 }
  )();
  if (!agentMeta) notFound();

  return (
    <>
      <Header
        title="Agent Performance"
        description={agentMeta.name}
        backHref={`/agents/${id}`}
        backLabel={`Back to ${agentMeta.name}`}
      />
      <Suspense fallback={<PerformanceSkeleton />}>
        <PerformanceContent id={id} />
      </Suspense>
      <div className="p-4 sm:p-6 pt-0">
        <Suspense fallback={null}>
          <AgentCohortGiving agentId={id} />
        </Suspense>
      </div>
    </>
  );
}
