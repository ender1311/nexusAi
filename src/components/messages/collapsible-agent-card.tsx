"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TestedVariablesBadges } from "@/components/agents/tested-variables-badges";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Channel, TestedVariable } from "@/types/agent";
import { maskPersonalization } from "@/lib/messages/personalization";

const channelColors: Record<Channel, string> = {
  push:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  email: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  sms:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

type Variant = {
  id: string;
  name: string;
  title: string | null;
  body: string | null;
  status: string;
};

type Message = {
  id: string;
  name: string;
  channel: string;
  testedVariables: unknown;
  variants: Variant[];
};

type Agent = {
  id: string;
  name: string;
  messages: Message[];
};

function CollapsibleMessage({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false);
  const testedVars = (msg.testedVariables ?? []) as TestedVariable[];

  return (
    <div className="border rounded-lg bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2 flex-wrap">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <p className="text-sm font-medium">{msg.name}</p>
          <Badge variant="outline" className={cn("text-xs capitalize", channelColors[msg.channel as Channel] ?? "")}>
            {msg.channel}
          </Badge>
          {testedVars.length > 0 && <TestedVariablesBadges variables={testedVars} />}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">{msg.variants.length} variants</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1 border-t pt-2">
          {msg.variants.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-2 bg-muted/40 rounded-md">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">{v.name}</span>
                {msg.channel === "push" && v.title && (
                  <span className="text-xs text-muted-foreground ml-2">· {maskPersonalization(v.title)}</span>
                )}
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{maskPersonalization(v.body)}</p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs ml-2 shrink-0",
                  v.status === "active"
                    ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/30"
                    : "text-yellow-700 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/30"
                )}
              >
                {v.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollapsibleAgentCard({ agent }: { agent: Agent }) {
  return (
    <Card>
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
        <div className="space-y-2">
          {agent.messages.map((msg) => (
            <CollapsibleMessage key={msg.id} msg={msg} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
