export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Channel } from "@/types/agent";
import Link from "next/link";
import { Bot, Mail, MessageSquare, Smartphone, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleAgentCard } from "@/components/messages/collapsible-agent-card";
import { prisma } from "@/lib/db";

const channelIcons: Record<Channel, LucideIcon> = {
  push: Smartphone,
  email: Mail,
  sms: MessageSquare,
};

async function getAgentsWithMessages() {
  return prisma.agent.findMany({
    where: { messages: { some: {} } },
    include: {
      messages: {
        include: { variants: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export default async function MessagesPage() {
  const agents = await getAgentsWithMessages();

  const allMessages = agents.flatMap((a) => a.messages);
  const byChannel = {
    push: allMessages.filter((m) => m.channel === "push"),
    email: allMessages.filter((m) => m.channel === "email"),
    sms: allMessages.filter((m) => m.channel === "sms"),
  };

  return (
    <>
      <Header title="Messages" description="All message templates across agents" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {(["push", "email", "sms"] as Channel[]).map((channel) => {
            const ChannelIcon = channelIcons[channel];
            return (
              <Card key={channel}>
                <CardContent className="p-4 flex items-center gap-3">
                  <ChannelIcon className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="text-2xl font-bold">{byChannel[channel].length}</p>
                    <p className="text-xs text-muted-foreground capitalize">{channel} messages</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No messages yet</p>
            <p className="text-sm text-muted-foreground mt-1">Messages are created per agent. Set up an agent first, then add message variants to test.</p>
            <Link href="/agents" className="mt-4">
              <Button size="sm" variant="outline">
                <Bot className="h-4 w-4 mr-1" />
                View Agents
              </Button>
            </Link>
          </div>
        )}

        {/* Messages grouped by agent */}
        {agents.map((agent) => (
          <CollapsibleAgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </>
  );
}
