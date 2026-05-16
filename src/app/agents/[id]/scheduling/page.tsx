export const revalidate = 900;

import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { SchedulingEditor } from "@/components/scheduling/scheduling-editor";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { FrequencyCap, QuietHours, SchedulingRule } from "@/types/agent";

export default async function SchedulingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const agent = await unstable_cache(
    () =>
      prisma.agent.findUnique({
        where: { id },
        select: { name: true, schedulingRule: true },
      }),
    ["agent-scheduling", id],
    { tags: [`agent-${id}`], revalidate: 900 }
  )();

  if (!agent) notFound();

  const schedulingRule: SchedulingRule | null = agent.schedulingRule
    ? {
        id: agent.schedulingRule.id,
        agentId: agent.schedulingRule.agentId,
        frequencyCap: agent.schedulingRule.frequencyCap as unknown as FrequencyCap,
        quietHours: agent.schedulingRule.quietHours as unknown as QuietHours,
        blackoutDates: agent.schedulingRule.blackoutDates as unknown as string[],
        smartSuppress: agent.schedulingRule.smartSuppress,
        suppressThresh: agent.schedulingRule.suppressThresh,
      }
    : null;

  return (
    <>
      <Header title="Scheduling & Guardrails" description={agent.name} />
      <SchedulingEditor agentId={id} initialRule={schedulingRule} />
    </>
  );
}
