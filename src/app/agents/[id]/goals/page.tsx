export const revalidate = 900;

import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { GoalsEditor } from "@/components/goals/goals-editor";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { Goal, GoalTier } from "@/types/agent";

export default async function GoalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const agent = await unstable_cache(
    () =>
      prisma.agent.findUnique({
        where: { id },
        select: { name: true, goals: true },
      }),
    ["agent-goals", id],
    { tags: [`agent-${id}`], revalidate: 900 }
  )();

  if (!agent) notFound();

  const goals: Goal[] = agent.goals.map((g) => ({
    id: g.id,
    agentId: g.agentId,
    eventName: g.eventName,
    tier: g.tier as GoalTier,
    valueWeight: g.valueWeight,
    weightMode: g.weightMode as "fixed" | "property",
    weightProperty: g.weightProperty ?? null,
    weightDefault: g.weightDefault,
    description: g.description ?? null,
  }));

  return (
    <>
      <Header title="Goals Configuration" description={agent.name} />
      <div className="p-4 sm:p-6 max-w-2xl space-y-4 sm:space-y-6">
        <GoalsEditor agentId={id} initialGoals={goals} />
      </div>
    </>
  );
}
