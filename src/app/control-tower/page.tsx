export const dynamic = "force-dynamic";

import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import { getCachedControlTowerAgents, getCachedControlTowerStats, getCachedFunnelStageBreakdown } from "@/lib/cache";

export default async function ControlTowerPage() {
  const [agents, stats, funnelBreakdown] = await Promise.all([
    getCachedControlTowerAgents().catch(() => []),
    getCachedControlTowerStats().catch(() => null),
    getCachedFunnelStageBreakdown().catch(() => []),
  ]);

  // brazeSends omitted from render path — external HTTP call (up to 3s on cold start)
  // blocks the entire server component. stats.totalDecisions is a reliable fallback.
  return <ControlTowerUI agents={agents} stats={stats} brazeSends={null} funnelBreakdown={funnelBreakdown} />;
}
