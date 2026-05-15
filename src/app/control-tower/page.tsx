export const revalidate = 60;

import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import { getCachedControlTowerAgents, getCachedControlTowerStats } from "@/lib/cache";

export default async function ControlTowerPage() {
  const [agents, stats] = await Promise.all([
    getCachedControlTowerAgents(),
    getCachedControlTowerStats(),
  ]);

  return <ControlTowerUI agents={agents} stats={stats} />;
}
