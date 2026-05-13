export const revalidate = 300;

import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { LiveDemoWizard } from "@/components/demo/LiveDemoWizard";
import { RewardIntelligencePanel } from "@/components/demo/RewardIntelligencePanel";

export default async function LiveDemoPage() {
  const [agents, personas] = await Promise.all([
    prisma.agent.findMany({
      where: {
        status: { in: ["active", "draft"] },
        messages: {
          some: {
            channel: "push",
            variants: { some: { status: "active" } },
          },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        funnelStage: true,
        goals: { select: { eventName: true, tier: true }, orderBy: { tier: "asc" }, take: 1 },
        messages: {
          where: { channel: "push" },
          select: { _count: { select: { variants: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.persona.findMany({
      where: { isActive: true },
      select: { id: true, name: true, color: true, icon: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    }),
  ]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <LiveDemoWizard agents={agents} personas={personas} />
      <Suspense>
        <RewardIntelligencePanel />
      </Suspense>
    </div>
  );
}
