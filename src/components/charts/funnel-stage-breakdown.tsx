import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FUNNEL_STAGE_META } from "@/types/agent";
import { formatNumber } from "@/lib/utils";

type Row = { stage: string; count: number };

function label(stage: string): string {
  return (FUNNEL_STAGE_META as Record<string, { label: string }>)[stage]?.label ?? stage;
}

export function FunnelStageBreakdown({ rows, title = "Users by Funnel Stage" }: { rows: Row[]; title?: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;

  // Sort: known stages first in canonical order, unknown last
  const ORDER = ["new", "dau4", "wau", "mau", "lapsed_dau4", "lapsed_wau", "lapsed_mau"];
  const sorted = [...rows].sort((a, b) => {
    const ai = ORDER.indexOf(a.stage);
    const bi = ORDER.indexOf(b.stage);
    if (ai === -1 && bi === -1) return b.count - a.count;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const maxCount = Math.max(...sorted.map((r) => r.count));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {sorted.map(({ stage, count }) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          const barW = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div key={stage} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label(stage)}</span>
                <span className="font-medium tabular-nums">
                  {formatNumber(count)}
                  <span className="text-muted-foreground font-normal ml-1">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/70 transition-all"
                  style={{ width: `${barW}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground pt-1 border-t">
          {formatNumber(total)} total tracked users
        </p>
      </CardContent>
    </Card>
  );
}
