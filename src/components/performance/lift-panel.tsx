import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCachedChartDecisions, getCachedLiftSettings } from "@/lib/cache";
import { baselineLiftSignificance } from "@/lib/engine/lift-significance";
import { prisma } from "@/lib/db";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { TimeSeriesPoint } from "@/types/metrics";
import { TrendingUp, TrendingDown, Star } from "lucide-react";

function formatPct(n: number, decimals = 1) {
  return `${n.toFixed(decimals)}%`;
}

function formatDate(d: Date | null) {
  if (!d) return "all-time";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type LiftPanelProps = {
  /** Pre-computed scored sends count (reward IS NOT NULL). When provided, skips the DB COUNT query. */
  nexusSendsCount?: number;
  /** Pre-computed positive conversions count (reward > 0). When provided, skips the DB COUNT query. */
  nexusConversionsCount?: number;
};

export async function LiftPanel({ nexusSendsCount: sendsProp, nexusConversionsCount: convProp }: LiftPanelProps = {}) {
  const { baselineRate, liftSince } = await getCachedLiftSettings();

  // Headline counts — use pre-computed values when passed in (avoids duplicate DB queries
  // when the parent already fetched them), otherwise fall back to uncached COUNT queries.
  let nexusSendsCount: number;
  let nexusConversionsCount: number;
  if (sendsProp !== undefined && convProp !== undefined) {
    nexusSendsCount = sendsProp;
    nexusConversionsCount = convProp;
  } else {
    const liftSinceFilter = liftSince ? { gte: liftSince } : undefined;
    [nexusSendsCount, nexusConversionsCount] = await Promise.all([
      prisma.userDecision.count({
        where: { sentAt: liftSinceFilter, reward: { not: null } },
      }),
      prisma.userDecision.count({
        where: { sentAt: liftSinceFilter, reward: { gt: 0 } },
      }),
    ]);
  }

  const lift = baselineLiftSignificance(nexusSendsCount, nexusConversionsCount, baselineRate);

  // Sparkline — from cached chart decisions (already limited to last 30 days).
  // Filter further to the lift window if a start date is configured.
  const { rewardByDate } = await getCachedChartDecisions();
  const liftSinceStr = liftSince?.toISOString().slice(0, 10) ?? null;

  const sparklineData: TimeSeriesPoint[] = rewardByDate
    .filter((r) => !liftSinceStr || r.date >= liftSinceStr)
    .map(({ date, scored, positive }) => ({
      date,
      sends: scored,
      conversions: positive,
      conversionRate: scored > 0 ? parseFloat(((positive / scored) * 100).toFixed(2)) : 0,
    }));

  // Display helpers
  const relativeLiftDisplay = lift.nexusSends === 0
    ? "—"
    : `${lift.relativeLift >= 0 ? "+" : ""}${lift.relativeLift.toFixed(0)}%`;

  const absoluteLiftDisplay = lift.nexusSends > 0
    ? `${lift.absoluteLift >= 0 ? "+" : ""}${lift.absoluteLift.toFixed(1)} pp`
    : null;

  const isPositive = lift.relativeLift >= 0;
  const liftColor = lift.nexusSends === 0
    ? "text-muted-foreground"
    : lift.insufficient
    ? "text-muted-foreground"
    : isPositive
    ? "text-green-600 dark:text-green-400"
    : "text-red-500";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">AI Lift vs Non-Nexus Baseline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Baseline (non-Nexus)</p>
            <p className="text-lg font-semibold">{formatPct(baselineRate)} open rate</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Nexus</p>
            <p className="text-lg font-semibold">
              {lift.nexusSends > 0 ? formatPct(lift.nexusRate) : "—"}
              {lift.nexusSends > 0 && <span className="text-xs font-normal text-muted-foreground ml-1">conv rate</span>}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lift</p>
            <p className={`text-lg font-semibold flex items-center gap-1 ${liftColor}`}>
              {lift.nexusSends > 0 && !lift.insufficient && isPositive && <TrendingUp className="h-4 w-4" />}
              {lift.nexusSends > 0 && !lift.insufficient && !isPositive && <TrendingDown className="h-4 w-4" />}
              {lift.insufficient && lift.nexusSends > 0 ? `~${relativeLiftDisplay}` : relativeLiftDisplay}
              {absoluteLiftDisplay && (
                <span className="text-sm font-normal">({absoluteLiftDisplay})</span>
              )}
            </p>
            {lift.significant && (
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-0.5">
                <Star className="h-3 w-3" />
                p &lt; 0.05
              </p>
            )}
            {!lift.significant && !lift.insufficient && lift.nexusSends > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">n.s.</p>
            )}
            {lift.insufficient && lift.nexusSends > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">Fewer than 200 scored sends</p>
            )}
          </div>
        </div>

        {/* Context line */}
        <p className="text-xs text-muted-foreground">
          {nexusSendsCount.toLocaleString()} scored sends · since {formatDate(liftSince)}
        </p>

        {/* Sparkline */}
        {sparklineData.length > 0 ? (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Daily Nexus conversion rate</p>
            <TimeSeriesChart data={sparklineData} height={140} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No scored sends in the chart window yet.</p>
        )}

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          Nexus rate = reward &gt; 0 / scored sends · Baseline: configured in Settings · since {formatDate(liftSince)}
        </p>
      </CardContent>
    </Card>
  );
}
