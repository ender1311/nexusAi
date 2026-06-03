import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { baselineLiftSignificance } from "@/lib/engine/lift-significance";
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

export type ComparisonCardProps = {
  /** Card heading, e.g. "Push Open Rate" or "Conversion Rate". */
  title: string;
  /** Nexus numerator — opens or positive conversions. */
  nexusNumerator: number;
  /** Nexus denominator — push sends or scored sends. Drives sample size. */
  nexusDenominator: number;
  /** Non-Nexus baseline rate as a percentage (e.g. 1.2). 0 means unset. */
  baselinePct: number;
  /** Noun for the rate, shown next to both rate figures (e.g. "open rate", "conv rate"). */
  metricNoun: string;
  /** Plural noun for the denominator, shown in the context line (e.g. "push sends", "scored sends"). */
  denominatorNoun: string;
  /** Window start date (null = all-time), shown in the context/footer lines. */
  liftSinceDate: Date | null;
  /** Optional daily sparkline of the Nexus rate over the window. */
  sparkline?: { data: TimeSeriesPoint[]; label: string };
  /** Footer caption describing how the Nexus rate is computed. */
  footer: string;
};

/**
 * Like-for-like comparison of a Nexus rate against a configured non-Nexus
 * baseline, using a one-proportion z-test (see baselineLiftSignificance).
 * Pure presentation + pure stats — no DB/IO; safe to render synchronously.
 */
export function ComparisonCard({
  title,
  nexusNumerator,
  nexusDenominator,
  baselinePct,
  metricNoun,
  denominatorNoun,
  liftSinceDate,
  sparkline,
  footer,
}: ComparisonCardProps) {
  const baselineUnset = baselinePct <= 0;
  const lift = baselineLiftSignificance(nexusDenominator, nexusNumerator, baselinePct);

  const relativeLiftDisplay =
    lift.nexusSends === 0
      ? "—"
      : `${lift.relativeLift >= 0 ? "+" : ""}${lift.relativeLift.toFixed(0)}%`;

  const absoluteLiftDisplay =
    lift.nexusSends > 0 ? `${lift.absoluteLift >= 0 ? "+" : ""}${lift.absoluteLift.toFixed(1)} pp` : null;

  const isPositive = lift.relativeLift >= 0;
  const liftColor =
    lift.nexusSends === 0 || lift.insufficient
      ? "text-muted-foreground"
      : isPositive
      ? "text-green-600 dark:text-green-400"
      : "text-red-500";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{title} — Nexus vs Non-Nexus</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Baseline (non-Nexus)</p>
            <p className="text-lg font-semibold">
              {baselineUnset ? (
                <span className="text-muted-foreground">Not set</span>
              ) : (
                <>
                  {formatPct(baselinePct)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">{metricNoun}</span>
                </>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Nexus</p>
            <p className="text-lg font-semibold">
              {lift.nexusSends > 0 ? formatPct(lift.nexusRate) : "—"}
              {lift.nexusSends > 0 && (
                <span className="text-xs font-normal text-muted-foreground ml-1">{metricNoun}</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lift</p>
            {baselineUnset ? (
              <p className="text-lg font-semibold text-muted-foreground">—</p>
            ) : (
              <>
                <p className={`text-lg font-semibold flex items-center gap-1 ${liftColor}`}>
                  {lift.nexusSends > 0 && !lift.insufficient && isPositive && <TrendingUp className="h-4 w-4" />}
                  {lift.nexusSends > 0 && !lift.insufficient && !isPositive && <TrendingDown className="h-4 w-4" />}
                  {lift.insufficient && lift.nexusSends > 0 ? `~${relativeLiftDisplay}` : relativeLiftDisplay}
                  {absoluteLiftDisplay && <span className="text-sm font-normal">({absoluteLiftDisplay})</span>}
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
                  <p className="text-xs text-muted-foreground mt-0.5">Fewer than 200 {denominatorNoun}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Context line */}
        <p className="text-xs text-muted-foreground">
          {nexusDenominator.toLocaleString()} {denominatorNoun} · since {formatDate(liftSinceDate)}
          {baselineUnset && " · set a baseline in Settings to see lift"}
        </p>

        {/* Sparkline */}
        {sparkline &&
          (sparkline.data.length > 0 ? (
            <div>
              <p className="text-xs text-muted-foreground mb-2">{sparkline.label}</p>
              <TimeSeriesChart data={sparkline.data} height={140} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No data in the chart window yet.</p>
          ))}

        {/* Footer */}
        <p className="text-xs text-muted-foreground">{footer}</p>
      </CardContent>
    </Card>
  );
}
