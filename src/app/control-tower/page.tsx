export const revalidate = 900;

import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import { getCachedControlTowerAgents, getCachedControlTowerStats, getCachedBrazeStats, getCachedFunnelStageBreakdown } from "@/lib/cache";

export default async function ControlTowerPage() {
  const [agents, stats, brazeStats, funnelBreakdown] = await Promise.all([
    getCachedControlTowerAgents().catch(() => []),
    getCachedControlTowerStats().catch(() => null),
    getCachedBrazeStats().catch(() => null),
    getCachedFunnelStageBreakdown().catch(() => []),
  ]);

  return <ControlTowerUI agents={agents} stats={stats} brazeSends={brazeStats?.sends ?? null} funnelBreakdown={funnelBreakdown} />;
}
