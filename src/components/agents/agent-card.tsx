import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Agent, FUNNEL_STAGE_META } from "@/types/agent";
import { AgentStatusBadge } from "./agent-status-badge";
import { formatNumber } from "@/lib/utils";
import { MessageSquare, Target } from "lucide-react";

interface AgentCardProps {
  agent: Agent;
  conversionRate?: number;
}

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson Sampling",
  epsilon_greedy: "ε-Greedy",
  contextual: "Contextual Bandit",
};

export function AgentCard({ agent, conversionRate }: AgentCardProps) {
  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="hover:shadow-md hover:border-primary/30 transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{agent.name}</p>
              {agent.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{agent.description}</p>
              )}
              <Badge variant="secondary" className="mt-1.5 text-xs font-normal">
                {FUNNEL_STAGE_META[agent.funnelStage].label} · {FUNNEL_STAGE_META[agent.funnelStage].description}
              </Badge>
            </div>
            <AgentStatusBadge status={agent.status} />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {agent.goals?.length ?? 0} goals
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {agent.messages?.length ?? 0} messages
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Algorithm</p>
              <p className="text-xs font-medium">{algorithmLabels[agent.algorithm]}</p>
            </div>
            {agent._count && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Decisions</p>
                <p className="text-xs font-medium">{formatNumber(agent._count.decisions)}</p>
              </div>
            )}
            {conversionRate !== undefined && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Conv. Rate</p>
                <p className="text-sm font-bold text-primary">{conversionRate.toFixed(1)}%</p>
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </Link>
  );
}
