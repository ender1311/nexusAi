import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyableId } from "@/components/ui/copyable-id";
import { getAgentSendDeliveryStatus } from "@/lib/agent-send-delivery-status";
import { classifyConfidence, summarizeVariantScores, type ConfidenceLevel } from "@/lib/agent-sends/confidence";
import { formatDateTime, formatScheduledDelivery } from "@/lib/agent-sends/format";
import type { SendRow } from "@/lib/agent-sends/types";
import { deliveryStatusLabel } from "./presentation";

const CONFIDENCE_DISPLAY: Record<ConfidenceLevel, { label: string; color: string; detail: string }> = {
  high: {
    label: "High confidence pick",
    color: "text-emerald-700 dark:text-emerald-400",
    detail: "This message has been working well for similar users",
  },
  moderate: {
    label: "Moderate confidence",
    color: "text-amber-700 dark:text-amber-500",
    detail: "This message looks promising — still learning",
  },
  exploratory: {
    label: "Exploratory pick",
    color: "text-muted-foreground",
    detail: "Gathering data — all options look similar right now",
  },
};

function WhyThisMessage({ row, variantNameMap }: { row: SendRow; variantNameMap?: Map<string, string> }) {
  const ctx = row.decisionContext;
  const scores = ctx?.variantScores;
  if (!scores || Object.keys(scores).length === 0) return null;

  const { sorted, winnerSharePct, maxScore } = summarizeVariantScores(scores);
  const top3 = sorted.slice(0, 3);
  const restCount = sorted.length - top3.length;
  const display = CONFIDENCE_DISPLAY[classifyConfidence(winnerSharePct)];

  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
        Why this message?
      </p>
      <p className={cn("text-xs font-medium", display.color)}>{display.label}</p>
      <p className="text-[11px] text-muted-foreground mb-2">{display.detail}</p>
      <div className="space-y-1">
        {top3.map(([vid, score]) => {
          const isSelected = vid === ctx?.selectedVariantId;
          const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
          const resolvedName = variantNameMap?.get(vid) ?? vid.slice(-6);
          return (
            <div key={vid} className="flex items-center gap-2">
              <span className={cn("text-[10px] w-32 shrink-0 truncate", isSelected ? "font-semibold text-primary" : "font-mono text-muted-foreground")}>
                {isSelected ? "★ " : "  "}{resolvedName}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full", isSelected ? "bg-primary" : "bg-muted-foreground/30")} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {restCount > 0 && (
          <p className="text-[10px] text-muted-foreground pl-[calc(128px+8px)]">
            +{restCount} other{restCount > 1 ? "s" : ""} with lower draws
          </p>
        )}
      </div>
    </div>
  );
}

export function ExpandedContent({ row, nowMs, variantNameMap }: { row: SendRow; nowMs: number; variantNameMap?: Map<string, string> }) {
  const status = getAgentSendDeliveryStatus(row, nowMs);
  return (
    <div className="px-4 py-3 bg-muted/30 border-t space-y-2.5">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Braze status</p>
        <p
          className={cn(
            "text-xs font-medium",
            status === "failed" && "text-red-600 dark:text-red-400",
            status === "pending" && "text-amber-700 dark:text-amber-400",
            status === "delivered" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {deliveryStatusLabel(status)}
        </p>
      </div>
      {row.variantTitle && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Title</p>
          <p className="text-sm font-medium">{row.variantTitle}</p>
        </div>
      )}
      {row.variantBody && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Body</p>
          <p className="text-sm text-foreground/80 leading-relaxed">{row.variantBody}</p>
        </div>
      )}
      {row.variantDeeplink && (
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground font-mono truncate">{row.variantDeeplink}</p>
        </div>
      )}
      <WhyThisMessage row={row} variantNameMap={variantNameMap} />
      <div className="flex flex-wrap gap-4 pt-1 border-t border-dashed">
        {row.brazeSendId && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Braze Send ID</p>
            <p className="text-xs font-mono text-muted-foreground">{row.brazeSendId}</p>
          </div>
        )}
        {row.brazeScheduleId && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Braze Schedule ID</p>
            <p className="text-xs font-mono text-muted-foreground">{row.brazeScheduleId}</p>
          </div>
        )}
        {row.conversionAt && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Converted</p>
            <p className="text-xs text-green-700">{formatDateTime(row.conversionAt)}</p>
          </div>
        )}
        {row.reward !== null && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Reward</p>
            <p className="text-xs font-mono">{row.reward.toFixed(2)}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">User ID</p>
          <CopyableId id={row.userId} className="text-xs text-muted-foreground" />
        </div>
        {row.scheduledFor && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Scheduled for</p>
            <p className="text-xs font-mono">{formatScheduledDelivery(row.scheduledFor)} recipient&apos;s local</p>
          </div>
        )}
      </div>
    </div>
  );
}
