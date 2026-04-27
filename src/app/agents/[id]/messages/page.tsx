export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { PushVariantPreviewCard } from "@/components/agents/push-variant-preview-card";

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      messages: {
        include: {
          variants: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!agent) notFound();

  return (
    <>
      <Header title="Messages & Variants" description={agent.name} />
      <div className="p-6 max-w-3xl space-y-6">
        {agent.messages.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
            <p className="font-medium">No messages configured</p>
            <p className="text-sm mt-1">Messages are managed via the seed script or Settings.</p>
          </div>
        ) : (
          agent.messages.map((msg) => (
            <Card key={msg.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-sm font-semibold">{msg.name}</CardTitle>
                    <Badge variant="outline" className={cn(
                      "text-xs capitalize",
                      msg.channel === "push" && "bg-blue-100 text-blue-700",
                      msg.channel === "email" && "bg-purple-100 text-purple-700",
                    )}>
                      {msg.channel}
                    </Badge>
                    {msg.brazeCampaignId && (
                      <Badge variant="outline" className="text-xs font-mono">
                        campaign: {msg.brazeCampaignId.slice(0, 8)}…
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{msg.variants.length} variants</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {msg.variants.map((v) => (
                  <PushVariantPreviewCard key={v.id} variant={v} channel={msg.channel} />
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
