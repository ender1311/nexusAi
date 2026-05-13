export const revalidate = 60;

import { prisma } from "@/lib/db";
import { ControlTowerUI } from "@/components/control-tower/control-tower-ui";
import type { StatsData } from "@/app/api/stats/route";
import type { SerializedAgent } from "@/components/control-tower/control-tower-ui";

async function fetchAgents(): Promise<SerializedAgent[]> {
  try {
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        funnelStage: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return agents;
  } catch (error) {
    console.error("control-tower: failed to fetch agents", error);
    return [];
  }
}

async function fetchStats(): Promise<StatsData | null> {
  try {
    const [trackedUsers, personas, agents, decisions, totalConversions] =
      await Promise.all([
        prisma.trackedUser.count(),
        prisma.persona.count({ where: { isActive: true } }),
        prisma.agent.count({ where: { status: "active" } }),
        prisma.userDecision.aggregate({
          _count: { id: true },
          _sum: { reward: true },
          where: {},
        }),
        prisma.userDecision.count({
          where: { conversionAt: { not: null } },
        }),
      ]);

    return {
      trackedUsers,
      personas,
      agents,
      totalDecisions: decisions._count.id,
      totalConversions,
    };
  } catch (error) {
    console.error("control-tower: failed to fetch stats", error);
    return null;
  }
}

export default async function ControlTowerPage() {
  const [agents, stats] = await Promise.all([fetchAgents(), fetchStats()]);

  return <ControlTowerUI agents={agents} stats={stats} />;
}
