export const revalidate = 900;

import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import { getCachedControlTowerAgents, getCachedControlTowerStats } from "@/lib/cache";

export default async function ControlTowerPage() {
  const [agents, stats] = await Promise.all([
    getCachedControlTowerAgents().catch(() => []),
    getCachedControlTowerStats().catch(() => null),
  ]);

  return <ControlTowerUI agents={agents} stats={stats} />;
}
