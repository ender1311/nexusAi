"use client";

import { VariantMetric } from "@/types/metrics";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface VariantComparisonProps {
  variants: VariantMetric[];
}

const channelColors: Record<string, string> = {
  push:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  email: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  sms:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

export function VariantComparison({ variants }: VariantComparisonProps) {
  const maxRate = Math.max(...variants.map((v) => v.ciHigh));

  return (
    <div className="space-y-3">
      {variants.map((v, i) => {
        const isTop = i === 0 || v.conversionRate === Math.max(...variants.map((x) => x.conversionRate));
        return (
          <div key={v.variantId} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-medium", isTop && "text-primary")}>{v.variantName}</span>
                <Badge variant="outline" className={cn("text-xs", channelColors[v.channel])}>
                  {v.channel}
                </Badge>
                {isTop && variants.length > 1 && (
                  <Badge className="text-xs bg-green-100 text-green-700 border-0 dark:bg-green-900/30 dark:text-green-400">Top</Badge>
                )}
              </div>
              <span className="font-semibold text-sm">{v.conversionRate.toFixed(2)}%</span>
            </div>
            <div className="relative h-5 bg-muted rounded-full overflow-hidden">
              {/* CI band */}
              <div
                className="absolute top-0 h-full bg-primary/20 rounded-full"
                style={{
                  left: `${(v.ciLow / maxRate) * 100}%`,
                  width: `${((v.ciHigh - v.ciLow) / maxRate) * 100}%`,
                }}
              />
              {/* Point estimate */}
              <div
                className="absolute top-0 h-full bg-primary rounded-full"
                style={{ width: `${(v.conversionRate / maxRate) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{v.sends.toLocaleString()} sends</span>
              <span>95% CI: [{v.ciLow.toFixed(1)}%, {v.ciHigh.toFixed(1)}%]</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
