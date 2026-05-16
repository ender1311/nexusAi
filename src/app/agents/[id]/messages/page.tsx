export const revalidate = 900;

import { Header } from "@/components/layout/header";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { AgentMessageManager } from "@/components/agents/agent-message-manager";
import { FrequencyCap } from "@/types/agent";

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // warmupUntil is pre-serialized to string so unstable_cache JSON roundtrip
  // doesn't break callers that expect .toISOString() to be available.
  const agent = await unstable_cache(
    async () => {
      const row = await prisma.agent.findUnique({
        where: { id },
        include: {
          messages: {
            include: { variants: { orderBy: { createdAt: "asc" } } },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!row) return null;
      return {
        ...row,
        messages: row.messages.map((m) => ({
          ...m,
          variants: m.variants.map((v) => ({
            ...v,
            warmupUntil: v.warmupUntil?.toISOString() ?? null,
          })),
        })),
      };
    },
    ["agent-messages", id],
    { tags: [`agent-${id}`], revalidate: 900 }
  )();

  if (!agent) notFound();

  const initialMessages = agent.messages.map((message) => ({
    id: message.id,
    name: message.name,
    channel: message.channel,
    brazeCampaignId: message.brazeCampaignId,
    variants: message.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      title: variant.title,
      body: variant.body,
      deeplink: variant.deeplink,
      iconImageUrl: variant.iconImageUrl,
      preferredHour: variant.preferredHour,
      preferredDayOfWeek: variant.preferredDayOfWeek,
      frequencyCapOverride:
        variant.frequencyCapOverride &&
        typeof variant.frequencyCapOverride === "object" &&
        !Array.isArray(variant.frequencyCapOverride) &&
        typeof (variant.frequencyCapOverride as Record<string, unknown>).maxSends === "number" &&
        ["day", "week", "biweek", "month"].includes(
          String((variant.frequencyCapOverride as Record<string, unknown>).period),
        )
          ? ({
              maxSends: Number((variant.frequencyCapOverride as Record<string, unknown>).maxSends),
              period: String((variant.frequencyCapOverride as Record<string, unknown>).period) as FrequencyCap["period"],
            } satisfies FrequencyCap)
          : null,
      status: variant.status,
      brazeVariantId: variant.brazeVariantId,
      warmupUntil: variant.warmupUntil,
    })),
  }));

  return (
    <>
      <Header title="Messages & Variants" description={agent.name} />
      <div className="p-4 sm:p-6 max-w-4xl">
        <AgentMessageManager agentId={agent.id} initialMessages={initialMessages} />
      </div>
    </>
  );
}
