import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";
import type { PreferredChannelStats } from "@/lib/cache/dashboard";

const CHANNEL_LABELS: Record<keyof PreferredChannelStats["overall"], string> = {
  push_notification: "Push",
  email: "Email",
  in_app_message: "In-App Message",
  content_card: "Content Card",
};

const ORDER: (keyof PreferredChannelStats["overall"])[] = [
  "push_notification",
  "email",
  "in_app_message",
  "content_card",
];

export function ChannelPreferenceBreakdown({
  stats,
  title = "Preferred Channel (90-day)",
}: {
  stats: PreferredChannelStats;
  title?: string;
}) {
  const counts = stats.overall;
  const known = ORDER.reduce((s, k) => s + counts[k], 0);
  if (known === 0) return null;

  const maxCount = Math.max(...ORDER.map((k) => counts[k]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {ORDER.map((channel) => {
          const count = counts[channel];
          const pct = known > 0 ? (count / known) * 100 : 0;
          const barW = maxCount > 0 ? (count / maxCount) * 100 : 0;
          const isPush = channel === "push_notification";
          return (
            <div key={channel} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className={cn("text-muted-foreground", isPush && "text-foreground font-medium")}>
                  {CHANNEL_LABELS[channel]}
                </span>
                <span className="font-medium tabular-nums">
                  {formatNumber(count)}
                  <span className="text-muted-foreground font-normal ml-1">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isPush ? "bg-primary" : "bg-primary/40")}
                  style={{ width: `${barW}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground pt-1 border-t">
          {formatNumber(known)} of {formatNumber(stats.total)} tracked users have a channel preference
        </p>
      </CardContent>
    </Card>
  );
}
