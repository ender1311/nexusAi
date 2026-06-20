import { Card, CardContent } from "@/components/ui/card";
import { agentCohortGiving } from "@/lib/cache/agent-giving";
import { formatNumber } from "@/lib/utils";

/**
 * Cohort giving profile — the intrinsic giving history of the agent's active
 * assigned users (from synced giving attributes). Streamed independently because
 * the underlying query parses giving attributes across the whole cohort.
 */
export async function AgentCohortGiving({ agentId }: { agentId: string }) {
  const c = await agentCohortGiving(agentId);
  if (c.assigned === 0 || c.givers === 0) return null;

  const giverPct = c.assigned > 0 ? (c.givers / c.assigned) * 100 : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Cohort giving profile</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Givers in cohort</p>
          <p className="text-2xl font-bold mt-1">{formatNumber(c.givers)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{giverPct.toFixed(1)}% of {formatNumber(c.assigned)} assigned</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Recurring givers</p>
          <p className="text-2xl font-bold mt-1">{formatNumber(c.recurringGivers)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">has_recurring_gift</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Lifetime gifts</p>
          <p className="text-2xl font-bold mt-1">{formatNumber(c.lifetimeGiftCount)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">across the cohort</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Lifetime giving</p>
          <p className="text-2xl font-bold mt-1">${formatNumber(Math.round(c.lifetimeGivingReported))}</p>
          <p className="text-xs text-muted-foreground mt-0.5">reported amounts</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Avg max gift</p>
          <p className="text-2xl font-bold mt-1">${c.avgMaxGiftReported.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">among givers</p>
        </CardContent></Card>
      </div>
    </div>
  );
}
