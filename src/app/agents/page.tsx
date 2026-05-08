export const dynamic = "force-dynamic";

import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentFilters } from "@/components/agents/agent-filters";
import { Button } from "@/components/ui/button";
import { AgentStatus, FunnelStage, FUNNEL_STAGES, Agent } from "@/types/agent";
import { Bot, Plus, Search } from "lucide-react";
import { prisma } from "@/lib/db";

const VALID_STATUSES = new Set<AgentStatus>(["active", "paused", "draft"]);
const VALID_STAGES = new Set<FunnelStage>(FUNNEL_STAGES);

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; stage?: string }>;
}) {
  const { search = "", status = "all", stage } = await searchParams;

  const safeStatus: AgentStatus | undefined =
    status !== "all" && VALID_STATUSES.has(status as AgentStatus)
      ? (status as AgentStatus)
      : undefined;

  const safeStage: FunnelStage | undefined =
    stage !== undefined && VALID_STAGES.has(stage as FunnelStage)
      ? (stage as FunnelStage)
      : undefined;

  const dbAgents = await prisma.agent.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(safeStatus ? { status: safeStatus } : {}),
      ...(safeStage ? { funnelStage: safeStage } : {}),
    },
    include: {
      _count: { select: { goals: true, messages: true, decisions: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Determine whether any filters are active (for empty-state messaging)
  const hasFilters = search !== "" || status !== "all" || stage !== undefined;

  // Map Prisma records to the shared Agent type
  const agents: Agent[] = dbAgents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    status: a.status as AgentStatus,
    algorithm: a.algorithm as Agent["algorithm"],
    epsilon: a.epsilon,
    funnelStage: a.funnelStage as FunnelStage,
    targetFilter: null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    _count: {
      goals: a._count.goals,
      messages: a._count.messages,
      decisions: a._count.decisions,
    },
  }));

  return (
    <>
      <Header title="Agents" description="Manage your Nexus agents" />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <AgentFilters search={search} status={status} stage={safeStage} />
          <Link href="/agents/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Agent
            </Button>
          </Link>
        </div>

        {agents.length === 0 ? (
          hasFilters ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No matching agents</p>
              <p className="text-sm text-muted-foreground mt-1">
                Try adjusting your search or filter criteria.
              </p>
              <Link href="/agents">
                <Button variant="ghost" size="sm" className="mt-4">
                  Clear filters
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
              <Bot className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No agents yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first Nexus agent to start optimizing message performance.
              </p>
              <Link href="/agents/new" className="mt-4">
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create Agent
                </Button>
              </Link>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
