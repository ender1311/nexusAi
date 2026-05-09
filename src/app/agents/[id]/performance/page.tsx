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
import { liftSignificance } from "@/lib/engine/lift-significance";

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

  // Per-persona arm stats (for breakdown section)
  const armStats = await prisma.personaArmStats.findMany({
    where: { agentId: id },
    select: { personaId: true, variantId: true, alpha: true, beta: true, tries: true, wins: true },
  });
  // Collect unique IDs for batch lookups
  const uniquePersonaIds = [...new Set(armStats.map((a) => a.personaId))];
  const uniqueVariantIds = [...new Set(armStats.map((a) => a.variantId))];
  const [personaRows, variantRows] = await Promise.all([
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
  ]);
  const personaById = new Map(personaRows.map((p) => [p.id, p]));
  const variantById = new Map(variantRows.map((v) => [v.id, v]));

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
    },
    orderBy: { sentAt: "asc" },
    // Safety cap: prevents unbounded memory growth for high-volume agents.
    // At typical send rates this window holds well under 5 000 rows.
    take: 5000,
  });

  // Fetch variant names separately to avoid a per-row JOIN in the main query
  const decidedVariantIds = [...new Set(decisions.map((d) => d.messageVariantId).filter((v): v is string => v !== null))];
  const variantNameRows = decidedVariantIds.length > 0
    ? await prisma.messageVariant.findMany({
        where: { id: { in: decidedVariantIds } },
        select: { id: true, name: true },
      })
    : [];
  const variantNameById = new Map(variantNameRows.map((v) => [v.id, v.name]));

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
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
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
    </>
  );
}
