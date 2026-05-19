export const revalidate = 900;

import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import { getCachedControlTowerAgents, getCachedControlTowerStats, getCachedBrazeStats } from "@/lib/cache";

export default async function ControlTowerPage() {
  const [agents, stats, brazeStats] = await Promise.all([
    getCachedControlTowerAgents().catch(() => []),
    getCachedControlTowerStats().catch(() => null),
    getCachedBrazeStats().catch(() => null),
  ]);

  return <ControlTowerUI agents={agents} stats={stats} brazeSends={brazeStats?.sends ?? null} />;
}
