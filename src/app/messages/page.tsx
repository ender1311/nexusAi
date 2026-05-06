export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Channel, TestedVariable } from "@/types/agent";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Bot, Mail, MessageSquare, Plus, Smartphone, type LucideIcon } from "lucide-react";
import { TestedVariablesBadges } from "@/components/agents/tested-variables-badges";
import { prisma } from "@/lib/db";

const channelColors: Record<Channel, string> = {
  push: "bg-blue-100 text-blue-700",
  email: "bg-purple-100 text-purple-700",
  sms: "bg-green-100 text-green-700",
};

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
          <Card key={agent.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">{agent.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{agent.messages.length} messages</p>
              </div>
              <Link href={`/agents/${agent.id}/messages`}>
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Message
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {agent.messages.map((msg) => {
                  const testedVars = (msg.testedVariables ?? []) as TestedVariable[];
                  return (
                    <div key={msg.id} className="border rounded-lg p-3 bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{msg.name}</p>
                          <Badge variant="outline" className={cn("text-xs capitalize", channelColors[msg.channel as Channel] ?? "")}>
                            {msg.channel}
                          </Badge>
                          {testedVars.length > 0 && (
                            <TestedVariablesBadges variables={testedVars} />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">{msg.variants.length} variants</span>
                      </div>
                      <div className="space-y-1">
                        {msg.variants.map((v) => (
                          <div key={v.id} className="flex items-center justify-between p-2 bg-muted/40 rounded-md">
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium">{v.name}</span>
                              {msg.channel === "push" && v.title && (
                                <span className="text-xs text-muted-foreground ml-2">· {v.title}</span>
                              )}
                              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{v.body}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs ml-2 shrink-0",
                                v.status === "active" ? "text-green-700 bg-green-50" : "text-yellow-700 bg-yellow-50"
                              )}
                            >
                              {v.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
