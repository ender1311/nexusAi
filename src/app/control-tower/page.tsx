export const dynamic = "force-dynamic";

import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import { getCachedControlTowerAgents, getCachedControlTowerStats, getCachedFunnelStageBreakdown, getCachedFleetRecoveryStats } from "@/lib/cache";

export default async function ControlTowerPage() {
  const [agents, stats, funnelBreakdown, recovery] = await Promise.all([
    getCachedControlTowerAgents().catch(() => []),
    getCachedControlTowerStats().catch(() => null),
    getCachedFunnelStageBreakdown().catch(() => []),
    getCachedFleetRecoveryStats().catch(() => ({ recoveries30d: 0, attributedRecoveries30d: 0, fleetRecoveryRate: 0 })),
  ]);

  // brazeSends omitted from render path — external HTTP call (up to 3s on cold start)
  // blocks the entire server component. stats.totalDecisions is a reliable fallback.
  return <ControlTowerUI agents={agents} stats={stats} brazeSends={null} funnelBreakdown={funnelBreakdown} recovery={recovery} />;
}
