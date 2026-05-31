import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { computeVariantDistribution, type ConvergenceState } from "@/lib/agent-sends/convergence-state";
import type { SendRow } from "@/lib/agent-sends/types";

const CONVERGENCE_CONFIG: Record<ConvergenceState, { label: string; desc: string; dotClass: string; textClass: string }> = {
  exploring: {
    label: "Exploring",
    desc: "Testing all messages equally — no pattern yet",
    dotClass: "bg-blue-400",
    textClass: "text-blue-600 dark:text-blue-400",
  },
  learning: {
    label: "Learning",
    desc: "A favorite is starting to emerge",
    dotClass: "bg-amber-400",
    textClass: "text-amber-600 dark:text-amber-500",
  },
  converging: {
    label: "Converging",
    desc: "One message is clearly pulling ahead",
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  confident: {
    label: "Confident",
    desc: "The system has found what works for this audience",
    dotClass: "bg-emerald-600",
    textClass: "text-emerald-700 dark:text-emerald-400",
  },
};

export function ConvergencePanel({ rows }: { rows: SendRow[] }) {
  const { entries, total, state } = useMemo(() => computeVariantDistribution(rows), [rows]);

  if (entries.length < 2 || total < 5) return null;

  const cfg = CONVERGENCE_CONFIG[state];
  const maxCount = entries[0]?.count ?? 1;
  const top5 = entries.slice(0, 5);
  const hasConversions = entries.some((e) => e.conversions > 0);

  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-2.5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Learning status
          </p>
          <div className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dotClass)} />
            <span className={cn("text-sm font-semibold", cfg.textClass)}>{cfg.label}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{cfg.desc}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{total} sends</span>
      </div>
      <div className="space-y-1.5">
        {top5.map((e, i) => {
          const sendPct = Math.round((e.count / total) * 100);
          const convPct = e.count > 0 ? Math.round((e.conversions / e.count) * 100) : 0;
          const isLeader = i === 0;
          return (
            <div key={e.name} className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs w-28 shrink-0 truncate",
                  isLeader ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {isLeader ? "★ " : "  "}{e.name}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full", isLeader ? "bg-primary" : "bg-muted-foreground/30")}
                  style={{ width: `${(e.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-7 text-right shrink-0">
                {sendPct}%
              </span>
              {hasConversions && (
                <span
                  className={cn(
                    "text-[10px] w-12 text-right shrink-0",
                    convPct > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-transparent",
                  )}
                >
                  {convPct > 0 ? `${convPct}% ✓` : "—"}
                </span>
              )}
            </div>
          );
        })}
        {entries.length > 5 && (
          <p className="text-[10px] text-muted-foreground pl-[calc(112px+8px)]">
            +{entries.length - 5} more
          </p>
        )}
      </div>
    </div>
  );
}
