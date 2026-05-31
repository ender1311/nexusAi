export const revalidate = 60;
export const maxDuration = 20;

import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentGrid } from "@/components/agents/agent-grid";
import { AgentFilters } from "@/components/agents/agent-filters";
import { Button } from "@/components/ui/button";
import { AgentStatus, FunnelStage, FUNNEL_STAGES, Agent } from "@/types/agent";
import { Bot, Plus, Search } from "lucide-react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { getHiddenStatsForCurrentUser } from "@/lib/user-preferences";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { getCachedAgentConvergenceStates, getCachedAgentCardStats } from "@/lib/cache";

const PAGE_SIZE = 20;

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

  const where = {
    name: { not: LIBRARY_AGENT_NAME },
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

  // Parallelize WorkOS auth check, agent list, convergence states, unique user counts,
  // and per-agent push open rate (sends + opens from local UserDecision rows — mirrors
  // the per-agent performance page so the card stat is consistent).
  const [{ isAdmin }, hiddenStats, { dbAgents }, convergenceStates, cardStats] = await Promise.all([
    getAuth(),
    getHiddenStatsForCurrentUser(),
    unstable_cache(
    async () => {
      const agents = await prisma.agent.findMany({
        where,
        include: {
          _count: { select: { goals: true, messages: true, decisions: true } },
          messages: { select: { _count: { select: { variants: true } } } },
        },
        orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
        take: PAGE_SIZE,
      });
      // Pre-serialize dates — unstable_cache uses JSON.stringify internally so
      // Date objects become strings on deserialization; doing it here keeps types correct.
      return {
        dbAgents: agents.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    },
    ["agents-list", search, safeStatus ?? "", safeStage ?? ""],
    { tags: ["agents"], revalidate: 900 },
  )(),
    getCachedAgentConvergenceStates(),
    getCachedAgentCardStats(),
  ]);

  const uniqueUsersMap = new Map(cardStats.uniqueUsers.map((r) => [r.agentId, r.count]));
  const pushStatsMap = new Map(
    cardStats.pushStats.map((r) => [r.agentId, { sends: r.sends, opens: r.opens }]),
  );

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
    color: a.color,
    targetFilter: null,
    audienceCap: a.audienceCap,
    uniqueUsersCap: a.uniqueUsersCap,
    dailySendCap: a.dailySendCap ?? null,
    targetSegmentName: a.targetSegmentName ?? null,
    uniqueUsers: uniqueUsersMap.get(a.id) ?? 0,
    pushSends: pushStatsMap.get(a.id)?.sends ?? 0,
    pushOpens: pushStatsMap.get(a.id)?.opens ?? 0,
    pushOpenRate: (() => {
      const s = pushStatsMap.get(a.id);
      return s && s.sends > 0 ? (s.opens / s.sends) * 100 : null;
    })(),
    sortOrder: a.sortOrder ?? 0,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
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
          {isAdmin && (
            <Link href="/agents/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New Agent
              </Button>
            </Link>
          )}
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
              {isAdmin && (
                <Link href="/agents/new" className="mt-4">
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Create Agent
                  </Button>
                </Link>
              )}
            </div>
          )
        ) : (
          <AgentGrid agents={agents} convergenceStates={convergenceStates} hiddenStats={hiddenStats} />
        )}
      </div>
    </>
  );
}
