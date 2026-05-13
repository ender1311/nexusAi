export const revalidate = 30;

import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentFilters } from "@/components/agents/agent-filters";
import { Button } from "@/components/ui/button";
import { AgentStatus, FunnelStage, FUNNEL_STAGES, Agent } from "@/types/agent";
import { Bot, Plus, Search } from "lucide-react";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 20;

function buildPageUrl(
  base: { search: string; status: string; stage?: FunnelStage },
  page: number,
): string {
  const params = new URLSearchParams();
  if (base.search) params.set("search", base.search);
  if (base.status !== "all") params.set("status", base.status);
  if (base.stage) params.set("stage", base.stage);
  if (page > 0) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/agents?${qs}` : "/agents";
}

const VALID_STATUSES = new Set<AgentStatus>(["active", "paused", "draft"]);
const VALID_STAGES = new Set<FunnelStage>(FUNNEL_STAGES);

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; stage?: string; page?: string }>;
}) {
  const { search = "", status = "all", stage, page } = await searchParams;
  const pageNum = Math.max(0, parseInt(page ?? "0", 10) || 0);

  const safeStatus: AgentStatus | undefined =
    status !== "all" && VALID_STATUSES.has(status as AgentStatus)
      ? (status as AgentStatus)
      : undefined;

  const safeStage: FunnelStage | undefined =
    stage !== undefined && VALID_STAGES.has(stage as FunnelStage)
      ? (stage as FunnelStage)
      : undefined;

  const where = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(safeStatus ? { status: safeStatus } : {}),
    ...(safeStage ? { funnelStage: safeStage } : {}),
  };

  const [dbAgents, totalCount] = await Promise.all([
    prisma.agent.findMany({
      where,
      include: {
        _count: { select: { goals: true, messages: true, decisions: true } },
        messages: { select: { _count: { select: { variants: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      skip: pageNum * PAGE_SIZE,
    }),
    prisma.agent.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = pageNum < totalPages - 1;
  const hasPrev = pageNum > 0;

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
      variants: a.messages.reduce((sum, m) => sum + m._count.variants, 0),
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
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted-foreground">
                  {pageNum * PAGE_SIZE + 1}–{Math.min((pageNum + 1) * PAGE_SIZE, totalCount)} of {totalCount} agents
                </span>
                <div className="flex gap-2">
                  {hasPrev && (
                    <Link href={buildPageUrl({ search, status, stage: safeStage }, pageNum - 1)}>
                      <Button variant="outline" size="sm">Previous</Button>
                    </Link>
                  )}
                  {hasNext && (
                    <Link href={buildPageUrl({ search, status, stage: safeStage }, pageNum + 1)}>
                      <Button variant="outline" size="sm">Next</Button>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
