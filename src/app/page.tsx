export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/charts/metric-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PersonaDistributionChart } from "@/components/charts/persona-distribution";
import { FunnelStageBreakdown } from "@/components/charts/funnel-stage-breakdown";
import { ChannelPreferenceBreakdown } from "@/components/charts/channel-preference-breakdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCachedAgentList,
  getCachedPersonaDistribution,
  getCachedDashboardCounts,
  getCachedTrackedUserCount,
  getCachedDashboardTimeSeries,
  getCachedRecentDecisions,
  getCachedAllVariantNames,
  getCachedFunnelStageBreakdown,
  getCachedPreferredChannelStats,
  getCachedFleetRecoveryStats,
  getCachedFleetGiftStats,
  getCachedAgentCardStats,
} from "@/lib/cache";
import { withTimeout } from "@/lib/with-timeout";
import { getCachedBrazeStats } from "@/lib/braze/analytics";
import { cn, formatNumber, formatDate } from "@/lib/utils";
import { agentRowBadge } from "@/lib/dashboard-agent-row";
import { getHiddenStatsForCurrentUser } from "@/lib/user-preferences";
import { isStatHidden } from "@/lib/stat-visibility";
import { TimeSeriesPoint, DecisionLog } from "@/types/metrics";
import { Bot, Send, TrendingUp, Users, Plus, CheckCircle2, XCircle, ChevronRight, Radar } from "lucide-react";
import { PushOpenRateCard } from "@/components/metrics/push-open-rate-card";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function MetricCardsSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </>
  );
}

function PushRateSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function CardSkeleton({ colSpan2 = false }: { colSpan2?: boolean }) {
  return (
    <Card className={colSpan2 ? "lg:col-span-2" : undefined}>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[180px] w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

function ListCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Async sub-components — each owns its own data fetch, streams independently
// ---------------------------------------------------------------------------

// Core cards — backed by fast indexed queries (sentAt index, agent list, 24h TrackedUser count cache).
// Intentionally excludes fleet recovery/gift stats so slow aggregates don't block this section.
async function MetricCardsSection() {
  const [{ sentLast24h, totalConversions, totalDecisions, totalPushSends }, agents, trackedUsers, hiddenStats] =
    await Promise.all([getCachedDashboardCounts(), getCachedAgentList(), getCachedTrackedUserCount(), getHiddenStatsForCurrentUser()]);
  const avgConvRate = totalDecisions > 0 ? (totalConversions / totalDecisions) * 100 : 0;
  const activeAgents = agents.filter((a) => a.status === "active").length;

  return (
    <>
      {!isStatHidden(hiddenStats, "dashboard.trackedUsers") && <MetricCard title="Tracked Users" value={formatNumber(trackedUsers)} description="synced from Hightouch" icon={Users} accentColor="violet" />}
      {!isStatHidden(hiddenStats, "dashboard.activeAgents") && <MetricCard title="Active Agents" value={activeAgents} description="currently running" icon={Bot} href="/agents" accentColor="cyan" />}
      {!isStatHidden(hiddenStats, "dashboard.messagesSent24h") && <MetricCard title="Messages Sent (24h)" value={formatNumber(sentLast24h)} description="across all channels" icon={Send} accentColor="pink" />}
      {avgConvRate > 0 && !isStatHidden(hiddenStats, "dashboard.avgConversionRate") && <MetricCard title="Avg Conversion Rate" value={`${avgConvRate.toFixed(2)}%`} description="last 30 days" icon={TrendingUp} accentColor="emerald" />}
      {!isStatHidden(hiddenStats, "dashboard.totalSends") && <MetricCard title="Total Sends" value={formatNumber(totalPushSends)} description="push, last 30 days" icon={Send} accentColor="indigo" />}
    </>
  );
}

// Fleet aggregate cards — separate Suspense so slow aggregates never block the core cards above.
async function FleetMetricCardsSection() {
  const [recovery, giftStats, hiddenStats] = await Promise.all([
    withTimeout(
      getCachedFleetRecoveryStats().catch(() => ({ recoveries30d: 0, attributedRecoveries30d: 0, fleetRecoveryRate: 0 })),
      6000,
      { recoveries30d: 0, attributedRecoveries30d: 0, fleetRecoveryRate: 0 },
    ),
    getCachedFleetGiftStats(),
    getHiddenStatsForCurrentUser(),
  ]);

  return (
    <>
      {recovery.recoveries30d > 0 && !isStatHidden(hiddenStats, "dashboard.recoveries") && (
        <MetricCard
          title="Lapsed Recovered (30d)"
          value={formatNumber(recovery.recoveries30d)}
          description={`${recovery.fleetRecoveryRate.toFixed(1)}% fleet recovery rate`}
          icon={TrendingUp}
          accentColor="green"
        />
      )}
      {giftStats.giftCount > 0 && !isStatHidden(hiddenStats, "dashboard.gifts") && (
        <MetricCard
          title="Gifts Driven (30d)"
          value={formatNumber(giftStats.giftCount)}
          description={`$${formatNumber(Math.round(giftStats.giftRevenue))} attributed revenue`}
          icon={TrendingUp}
          accentColor="amber"
        />
      )}
      {giftStats.sowerCount > 0 && !isStatHidden(hiddenStats, "dashboard.sowers") && (
        <MetricCard
          title="Sowers Driven (30d)"
          value={formatNumber(giftStats.sowerCount)}
          description="recurring givers converted"
          icon={TrendingUp}
          accentColor="orange"
        />
      )}
    </>
  );
}

async function PushOpenRateSection() {
  const [{ totalPushSends, totalPushOpens }, brazeStats, hiddenStats] = await Promise.all([
    getCachedDashboardCounts(),
    getCachedBrazeStats(),
    getHiddenStatsForCurrentUser(),
  ]);
  if (isStatHidden(hiddenStats, "dashboard.pushOpenRate")) return null;
  const nexusOpenRate = totalPushSends > 0 ? (totalPushOpens / totalPushSends) * 100 : 0;
  const bestOpenRate = Math.max(nexusOpenRate, brazeStats?.directOpenRate ?? 0);

  return (
    <PushOpenRateCard
      value={totalPushSends > 0 || brazeStats ? `${bestOpenRate.toFixed(2)}%` : "—"}
      description="push notifications"
    />
  );
}

async function TimeSeriesSection() {
  const now = new Date();
  const rows = await getCachedDashboardTimeSeries();
  const byDate = new Map(rows.map((r) => [r.date, { sends: r.sends, conversions: r.conversions }]));

  const last7Days: TimeSeriesPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const { sends, conversions } = byDate.get(key) ?? { sends: 0, conversions: 0 };
    last7Days.push({ date: key, sends, conversions, conversionRate: sends > 0 ? (conversions / sends) * 100 : 0 });
  }

  const hasConversions = last7Days.some((p) => p.conversionRate > 0);
  if (!hasConversions) return null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Conversion Rate (7 days)</CardTitle>
        <Badge variant="outline" className="text-xs">All Agents</Badge>
      </CardHeader>
      <CardContent>
        <TimeSeriesChart data={last7Days} height={220} showSends />
      </CardContent>
    </Card>
  );
}

async function AgentsSidebar() {
  const [agents, cardStats] = await Promise.all([getCachedAgentList(), getCachedAgentCardStats()]);
  const pushByAgent = new Map(cardStats.pushStats.map((s) => [s.agentId, s]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-bold">Agents</CardTitle>
        <Link href="/agents" className="text-sm text-primary font-medium hover:opacity-75 transition-opacity flex items-center gap-0.5">
          See all <ChevronRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {agents.map((agent) => {
          const initial = agent.name.charAt(0).toUpperCase();
          const stage = (agent.funnelStage ?? "wau").toUpperCase();
          const badge = agentRowBadge(agent.status, agent._count.decisions);
          const push = pushByAgent.get(agent.id);
          const openRate = push && push.sends > 0 ? (push.opens / push.sends) * 100 : null;
          const avatarColor = agent.color ?? "#6366f1";
          const openRateCls = openRate === null ? "text-muted-foreground"
            : openRate >= 12 ? "text-emerald-400"
            : openRate >= 7  ? "text-green-500"
            : openRate >= 4  ? "text-amber-400"
            : "text-muted-foreground";
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <div className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-muted hover:border-primary/40 transition-colors cursor-pointer">
                <div
                  className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: avatarColor }}
                >
                  <span className="text-sm font-bold text-white">{initial}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold">{agent.name}</span>
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full leading-tight shrink-0">{stage}</span>
                  </div>
                  {agent.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.description}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {badge.kind === "draft" ? (
                    <Badge variant="outline" className="text-xs">Draft</Badge>
                  ) : (
                    <>
                      <p className="text-sm font-bold tabular-nums leading-tight">{formatNumber(badge.decisions)}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">sends</p>
                      {openRate !== null && (
                        <p className={cn("text-[11px] font-semibold leading-tight mt-0.5", openRateCls)}>
                          {openRate.toFixed(1)}% open
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
        {agents.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No agents yet</p>
        )}
      </CardContent>
    </Card>
  );
}

async function RecentSendsSection() {
  const [recentDecisionsRaw, variantNames, agents] = await Promise.all([
    getCachedRecentDecisions(),
    getCachedAllVariantNames(),
    getCachedAgentList(),
  ]);
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
  const variantNameById = new Map(variantNames.map((v) => [v.id, v.name]));

  const recentSends: DecisionLog[] = recentDecisionsRaw.map((d) => ({
    id: d.id,
    userId: d.userId,
    agentName: agentNameById.get(d.agentId) ?? "Unknown",
    channel: d.channel,
    variantName: (d.messageVariantId ? variantNameById.get(d.messageVariantId) : undefined) ?? "—",
    sentAt: d.sentAt,
    converted: d.conversionAt !== null,
    reward: d.reward ?? undefined,
  }));

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Recent Sends</CardTitle>
        <Link href="/performance">
          <Button variant="ghost" size="sm" className="h-7 text-xs">View all</Button>
        </Link>
      </CardHeader>
      <CardContent>
        {recentSends.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No sends yet</p>
        ) : (
          <div className="space-y-1">
            {recentSends.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between text-xs py-1.5 border-b last:border-0"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {d.converted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="font-mono text-muted-foreground">{d.userId}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-medium truncate">{d.variantName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <Badge variant="outline" className="text-xs capitalize">{d.channel}</Badge>
                  <span className="text-muted-foreground">{formatDate(d.sentAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function PersonaChartSection() {
  const personasRaw = await getCachedPersonaDistribution();
  const totalPersonaUsers = personasRaw.reduce((s, p) => s + p._count.trackedUsers, 0);
  const personaData = personasRaw
    .filter((p) => p._count.trackedUsers > 0)
    .map((p) => ({
      name: p.name,
      label: p.label ?? p.name,
      value: p._count.trackedUsers,
      percent: totalPersonaUsers > 0 ? Math.round((p._count.trackedUsers / totalPersonaUsers) * 100) : 0,
      color: p.color,
    }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Persona Distribution</CardTitle>
        <Link href="/personas">
          <Button variant="ghost" size="sm" className="h-7 text-xs">View all</Button>
        </Link>
      </CardHeader>
      <CardContent>
        <PersonaDistributionChart data={personaData} />
      </CardContent>
    </Card>
  );
}

async function TopPersonaSection() {
  const personasRaw = await getCachedPersonaDistribution();
  const topPersona = personasRaw[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Top Persona</CardTitle>
      </CardHeader>
      <CardContent>
        {topPersona && topPersona._count.trackedUsers > 0 ? (
          <div className="rounded-lg p-2 -m-2">
            <p className="text-sm font-medium">{topPersona.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{topPersona.label ?? topPersona.name}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{formatNumber(topPersona._count.trackedUsers)}</span> users
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No persona data yet</p>
        )}
      </CardContent>
    </Card>
  );
}

async function FunnelBreakdownSection() {
  const rows = await withTimeout(
    getCachedFunnelStageBreakdown().catch(() => []),
    6000,
    [] as Awaited<ReturnType<typeof getCachedFunnelStageBreakdown>>,
  );
  return <FunnelStageBreakdown rows={rows} />;
}

async function ChannelBreakdownSection() {
  const stats = await getCachedPreferredChannelStats().catch(() => null);
  if (!stats) return null;
  return <ChannelPreferenceBreakdown stats={stats} />;
}

// ---------------------------------------------------------------------------
// Main page — synchronous shell, all data streams via Suspense
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  // Pre-kick all fetches in parallel immediately — React.cache() deduplicates
  // these promises so each Suspense boundary gets the already-in-flight result
  // instead of starting a new DB round-trip when React processes the boundary.
  void getCachedDashboardCounts();
  void getCachedTrackedUserCount();
  void getCachedAgentList();
  void getCachedAgentCardStats();
  void getCachedBrazeStats();
  void getCachedDashboardTimeSeries();
  void getCachedRecentDecisions();
  void getCachedAllVariantNames();
  void getCachedPersonaDistribution();
  void getCachedFunnelStageBreakdown();
  void getCachedPreferredChannelStats();
  void getCachedFleetRecoveryStats();
  void getCachedFleetGiftStats();

  return (
    <>
      <Header title="Dashboard" description="Nexus platform overview" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Metric cards row — two independent Suspense groups so core cards paint first */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <Suspense fallback={<MetricCardsSkeleton />}>
            <MetricCardsSection />
          </Suspense>
          <Suspense fallback={null}>
            <FleetMetricCardsSection />
          </Suspense>
          <Suspense fallback={<PushRateSkeleton />}>
            <PushOpenRateSection />
          </Suspense>
        </div>

        {/* Agents + Recent Sends side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <Suspense fallback={<ListCardSkeleton />}>
            <AgentsSidebar />
          </Suspense>
          <Suspense
            fallback={
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-7 w-16" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            }
          >
            <RecentSendsSection />
          </Suspense>
        </div>

        {/* Funnel breakdown + Persona distribution + Channel preference side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <Suspense fallback={<CardSkeleton />}>
            <FunnelBreakdownSection />
          </Suspense>
          <Suspense fallback={<CardSkeleton />}>
            <PersonaChartSection />
          </Suspense>
          <Suspense fallback={<CardSkeleton />}>
            <ChannelBreakdownSection />
          </Suspense>
        </div>

        {/* Quick Actions + Top Persona side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/agents/new">
                <Button className="w-full justify-start" variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Agent
                </Button>
              </Link>
              <Link href="/performance">
                <Button className="w-full justify-start" variant="outline" size="sm">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  View Performance
                </Button>
              </Link>
              <Link href="/messages">
                <Button className="w-full justify-start" variant="outline" size="sm">
                  <Send className="h-4 w-4 mr-2" />
                  Manage Messages
                </Button>
              </Link>
              <Link href="/control-tower">
                <Button className="w-full justify-start" variant="outline" size="sm">
                  <Radar className="h-4 w-4 mr-2" />
                  Control Tower
                </Button>
              </Link>
            </CardContent>
          </Card>
          <Suspense fallback={<CardSkeleton />}>
            <TopPersonaSection />
          </Suspense>
        </div>

        {/* Time series — full width, only renders when conversion data exists */}
        <Suspense fallback={null}>
          <TimeSeriesSection />
        </Suspense>
      </div>
    </>
  );
}
