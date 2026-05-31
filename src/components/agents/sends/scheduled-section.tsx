import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "@/components/ui/copyable-id";
import { cn } from "@/lib/utils";
import { getAgentSendDeliveryStatus } from "@/lib/agent-send-delivery-status";
import { formatScheduledDelivery } from "@/lib/agent-sends/format";
import type { SendRow } from "@/lib/agent-sends/types";
import { ExpandedContent } from "./expanded-content";
import { personaDot } from "./presentation";

/** Scheduled (future) sends — compact card list above the main sent table */
export function ScheduledSection({ rows, expanded, onToggle, nowMs, variantNameMap }: {
  rows: SendRow[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  nowMs: number;
  variantNameMap: Map<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Clock className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Scheduled — {rows.length} pending
        </span>
        <span className="text-xs text-muted-foreground/70 italic">· times are each recipient&apos;s local delivery time</span>
      </div>
      {rows.map((row) => {
        const isOpen = expanded.has(row.id);
        const st = getAgentSendDeliveryStatus(row, nowMs);
        return (
          <div
            key={row.id}
            className={cn(
              "rounded-lg border overflow-hidden",
              st === "failed" && "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20",
              st === "pending" && "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20",
              st === "delivered" && "border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-950/15",
            )}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-black/5"
              onClick={() => onToggle(row.id)}
            >
              {isOpen
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium truncate leading-snug">{row.variantName ?? "—"}</p>
                  <Badge variant="outline" className="text-xs capitalize shrink-0 self-center hidden sm:inline-flex">{row.channel}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <CopyableId
                    id={row.userId}
                    display={row.userId.length > 14 ? `${row.userId.slice(0, 14)}…` : row.userId}
                    className="text-xs text-muted-foreground"
                  />
                  {row.personaName && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", personaDot(row.personaColor))} />
                      {row.personaName}
                    </span>
                  )}
                </div>
                {row.scheduledFor && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      {formatScheduledDelivery(row.scheduledFor)}
                      <span className="text-muted-foreground"> · recipient&apos;s local</span>
                    </span>
                  </div>
                )}
              </div>
            </button>
            {isOpen && <ExpandedContent row={row} nowMs={nowMs} variantNameMap={variantNameMap} />}
          </div>
        );
      })}
    </div>
  );
}
