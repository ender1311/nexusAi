import { Persona } from "@/types/persona";
import { PERSONA_COLORS } from "@/lib/persona-display";
import { cn, formatNumber } from "@/lib/utils";

interface AudienceDistributionProps {
  personas: Persona[];
  totalUsers: number;
}

export function AudienceDistribution({ personas, totalUsers }: AudienceDistributionProps) {
  const assigned = personas
    .map((p) => ({ ...p, count: p._count?.trackedUsers ?? 0 }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  const unassigned = Math.max(0, totalUsers - assigned.reduce((s, p) => s + p.count, 0));

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Audience Distribution</p>
        <p className="text-xs text-muted-foreground">{formatNumber(totalUsers)} assigned users</p>
      </div>

      {/* Stacked bar */}
      <div className="flex h-3 w-full rounded-full overflow-hidden gap-px">
        {assigned.map((p) => {
          const colors = PERSONA_COLORS[p.color] ?? PERSONA_COLORS.blue;
          const pct = (p.count / totalUsers) * 100;
          return (
            <div
              key={p.id}
              className={cn("h-full transition-all", colors.dot.replace("rounded-full", ""))}
              style={{ width: `${pct}%` }}
              title={`${p.name}: ${pct.toFixed(1)}%`}
            />
          );
        })}
        {unassigned > 0 && (
          <div
            className="h-full bg-muted flex-1"
            title={`Unassigned: ${((unassigned / totalUsers) * 100).toFixed(1)}%`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {assigned.map((p) => {
          const colors = PERSONA_COLORS[p.color] ?? PERSONA_COLORS.blue;
          const pct = (p.count / totalUsers) * 100;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full shrink-0", colors.dot)} />
              <span className="text-xs text-muted-foreground">{p.name}</span>
              <span className="text-xs font-semibold">{pct.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">({formatNumber(p.count)})</span>
            </div>
          );
        })}
        {unassigned > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
            <span className="text-xs text-muted-foreground">Unassigned</span>
            <span className="text-xs font-semibold">{((unassigned / totalUsers) * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
