import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { agentGiftMetrics } from "@/lib/cache/agent-gift-metrics";
import { formatNumber } from "@/lib/utils";

/**
 * Compact gift/revenue cards for the agent Overview tab. Renders for agents that
 * have a gift_given goal or have any attributed gifts. Full per-variant and
 * user-level breakdowns live on the Performance tab.
 */
export async function AgentGiftOverviewCards({ agentId }: { agentId: string }) {
  const [giftGoal, metrics] = await Promise.all([
    prisma.goal.findFirst({ where: { agentId, eventName: "gift_given" }, select: { id: true } }),
    agentGiftMetrics(agentId),
  ]);

  const isGiftAgent = giftGoal !== null || metrics.giftCount > 0 || metrics.sowerCount > 0;
  if (!isGiftAgent) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-muted-foreground">Gifts driven · last 30 days</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Gifts</p>
          <p className="text-2xl font-bold mt-1">{formatNumber(metrics.giftCount)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Gift Revenue</p>
          <p className="text-2xl font-bold mt-1 text-primary">${formatNumber(Math.round(metrics.giftRevenue))}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Gift Conv. Rate</p>
          <p className="text-2xl font-bold mt-1">{metrics.giftConversionRate.toFixed(2)}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Recurring givers</p>
          <p className="text-2xl font-bold mt-1">{formatNumber(metrics.sowerCount)}</p>
        </CardContent></Card>
      </div>
    </div>
  );
}
