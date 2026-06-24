export const revalidate = 60;
export const maxDuration = 20;

import { Suspense } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentGrid } from "@/components/agents/agent-grid";
import { AgentFilters } from "@/components/agents/agent-filters";
import { KillSwitchToggle } from "@/components/control-tower/kill-switch-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentStatus, FunnelStage, FUNNEL_STAGES, Agent } from "@/types/agent";
import { Bot, Plus, Search } from "lucide-react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { getHiddenStatsForCurrentUser } from "@/lib/user-preferences";
import { getCachedAgentConvergenceStates, getCachedAgentCardStats, getCachedKillSwitchSetting } from "@/lib/cache";
import { withTimeout } from "@/lib/with-timeout";
import { parseSegmentTargeting } from "@/lib/agent-targeting";

const PAGE_SIZE = 20;

const VALID_STATUSES = new Set<AgentStatus>(["active", "paused", "draft"]);
const VALID_STAGES = new Set<FunnelStage>(FUNNEL_STAGES);

async function AgentsHeaderActions() {
  const [{ isAdmin }, killSwitchSetting] = await Promise.all([
    getAuth(),
    getCachedKillSwitchSetting(),
  ]);
  if (!isAdmin) return null;
  const killSwitchOn = killSwitchSetting?.value === "true";
  return <KillSwitchToggle initialOn={killSwitchOn} />;
}

async function AgentsContent({
  search,
  safeStatus,
  safeStage,
  hasFilters,
}: {
  search: string;
  safeStatus: AgentStatus | undefined;
  safeStage: FunnelStage | undefined;
  hasFilters: boolean;
}) {
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

  const [{ isAdmin }, hiddenStats, { dbAgents }, convergenceStates, cardStats, killSwitchSetting] = await Promise.all([
    getAuth(),
    getHiddenStatsForCurrentUser(),
    unstable_cache(
      async () => {
        const agents = await prisma.agent.findMany({
          where,
          include: {
            // NOTE: `decisions` deliberately excluded — an all-time COUNT over the
            // huge UserDecision table per agent made this list query hang on a cold
            // cache (504s). goals/messages/variants counts are cheap (small tables).
            // The decisions stat is sourced from the bounded card-stats cache below.
            _count: { select: { goals: true, messages: true } },
            messages: { select: { _count: { select: { variants: true } } } },
          },
          orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
          take: PAGE_SIZE,
        });
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
    // Bound the heavy per-agent aggregate caches: if they're recomputing on a cold
    // cache and the underlying GROUP BYs are slow, the page renders with fallback
    // stats instead of timing out (504). The caches still warm in the background.
    withTimeout(getCachedAgentConvergenceStates(), 6000, {} as Awaited<ReturnType<typeof getCachedAgentConvergenceStates>>),
    withTimeout(getCachedAgentCardStats(), 6000, { uniqueUsers: [], pushStats: [], assigned: [], decisions: [] }),
    getCachedKillSwitchSetting(),
  ]);

  const killSwitchOn = killSwitchSetting?.value === "true";

  const uniqueUsersMap = new Map(cardStats.uniqueUsers.map((r) => [r.agentId, r.count]));
  const assignedMap = new Map(cardStats.assigned.map((r) => [r.agentId, r.count]));
  const decisionsMap = new Map(cardStats.decisions.map((r) => [r.agentId, r.count]));
  const pushStatsMap = new Map(
    cardStats.pushStats.map((r) => [r.agentId, { sends: r.sends, opens: r.opens }]),
  );

  const agents: Agent[] = dbAgents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    status: a.status as AgentStatus,
    sendingPaused: a.sendingPaused,
    algorithm: a.algorithm as Agent["algorithm"],
    epsilon: a.epsilon,
    funnelStage: a.funnelStage as FunnelStage,
    color: a.color,
    targetFilter: null,
    uniqueUsersCap: a.uniqueUsersCap,
    dailySendCap: a.dailySendCap ?? null,
    targetSegmentName: a.targetSegmentName ?? null,
    segmentTargeting: parseSegmentTargeting(a.segmentTargeting),
    uniqueUsers: uniqueUsersMap.get(a.id) ?? 0,
    assigned: assignedMap.get(a.id) ?? 0,
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
      decisions: decisionsMap.get(a.id) ?? 0,
      variants: a.messages.reduce((sum, m) => sum + m._count.variants, 0),
    },
  }));

  return (
    <>
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
        <AgentGrid
          agents={agents}
          convergenceStates={convergenceStates}
          hiddenStats={hiddenStats}
          isAdmin={isAdmin}
          killSwitchOn={killSwitchOn}
        />
      )}
    </>
  );
}

function AgentsContentSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}

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

  const hasFilters = search !== "" || status !== "all" || stage !== undefined;

  return (
    <>
      <Header title="Agents" description="Manage your Nexus agents">
        <Suspense fallback={<Skeleton className="h-8 w-28" />}>
          <AgentsHeaderActions />
        </Suspense>
      </Header>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Filter row renders immediately — client component reads URL via useSearchParams */}
        <AgentFilters search={search} status={status} stage={safeStage} />

        {/* Auth + DB content streams in behind a skeleton */}
        <Suspense fallback={<AgentsContentSkeleton />}>
          <AgentsContent
            search={search}
            safeStatus={safeStatus}
            safeStage={safeStage}
            hasFilters={hasFilters}
          />
        </Suspense>
      </div>
    </>
  );
}
