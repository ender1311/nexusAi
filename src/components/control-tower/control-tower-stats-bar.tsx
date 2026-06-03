import { Users } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface ControlTowerStatsBarProps {
  stats: { trackedUsers: number; personas: number; totalDecisions: number; totalConversions: number } | null;
  brazeSends: number | null;
  recovery: { recoveries30d: number };
}

/** Live database stats bar for the control tower. Pure presentation. */
export function ControlTowerStatsBar({ stats, brazeSends, recovery }: ControlTowerStatsBarProps) {
  return (
    <div className="border-b bg-muted/30 px-4 sm:px-6 py-2 sm:py-2.5 flex items-center gap-4 sm:gap-6 text-sm shrink-0 overflow-x-auto">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">
          {stats ? formatNumber(stats.trackedUsers) : "—"}
        </span>
        <span>users tracked</span>
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">
          {stats ? stats.personas : "—"}
        </span>
        {" "}active personas
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">
          {brazeSends != null ? formatNumber(brazeSends) : stats ? formatNumber(stats.totalDecisions) : "—"}
        </span>
        {" "}messages sent
      </span>
      {stats && stats.totalDecisions > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {((stats.totalConversions / stats.totalDecisions) * 100).toFixed(1)}%
            </span>
            {" "}conversion rate
          </span>
        </>
      )}
      {recovery.recoveries30d > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {formatNumber(recovery.recoveries30d)}
            </span>
            {" "}lapsed recovered (30d)
          </span>
        </>
      )}
    </div>
  );
}
