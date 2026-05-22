export const revalidate = 60;
export const maxDuration = 30;

import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/charts/metric-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PersonaDistributionChart } from "@/components/charts/persona-distribution";
import { FunnelStageBreakdown } from "@/components/charts/funnel-stage-breakdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCachedAgentList,
  getCachedPersonaDistribution,
  getCachedDashboardCounts,
  getCachedDashboardTimeSeries,
  getCachedRecentDecisions,
  getCachedBrazeStats,
  getCachedAllVariantNames,
  getCachedFunnelStageBreakdown,
} from "@/lib/cache";
import { formatNumber, formatDate } from "@/lib/utils";
import { TimeSeriesPoint, DecisionLog } from "@/types/metrics";
import { Bot, Send, TrendingUp, Users, Plus, CheckCircle2, XCircle } from "lucide-react";
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

async function MetricCardsSection() {
  const [{ sentLast24h, totalConversions, totalDecisions, trackedUsers, totalPushSends }, agents] =
    await Promise.all([getCachedDashboardCounts(), getCachedAgentList()]);
  const avgConvRate = totalDecisions > 0 ? (totalConversions / totalDecisions) * 100 : 0;
  const activeAgents = agents.filter((a) => a.status === "active").length;

  return (
    <>
      <MetricCard title="Tracked Users" value={formatNumber(trackedUsers)} description="synced from Hightouch" icon={Users} />
      <MetricCard title="Active Agents" value={activeAgents} description="currently running" icon={Bot} trend={0} />
      <MetricCard title="Messages Sent (24h)" value={formatNumber(sentLast24h)} description="across all channels" icon={Send} />
      {avgConvRate > 0 && <MetricCard title="Avg Conversion Rate" value={`${avgConvRate.toFixed(2)}%`} description="across active agents" icon={TrendingUp} />}
      <MetricCard title="Total Sends" value={formatNumber(totalPushSends)} description="push notifications" icon={Send} />
    </>
  );
}

async function PushOpenRateSection() {
  const [{ totalPushSends, totalPushOpens }, brazeStats] = await Promise.all([
    getCachedDashboardCounts(),
    getCachedBrazeStats(),
  ]);
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
  const agents = await getCachedAgentList();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Agents</CardTitle>
        <Link href="/agents/new">
          <Button size="sm" variant="outline" className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {agents.map((agent) => (
          <Link key={agent.id} href={`/agents/${agent.id}`}>
            <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{agent.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{agent.status}</p>
              </div>
              {agent._count.decisions > 0 ? (
                <span className="text-xs font-bold text-primary ml-2">
                  {formatNumber(agent._count.decisions)} sends
                </span>
              ) : (
                <Badge variant="outline" className="text-xs">Draft</Badge>
              )}
            </div>
          </Link>
        ))}
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
  const rows = await getCachedFunnelStageBreakdown().catch(() => []);
  return <FunnelStageBreakdown rows={rows} />;
}

// ---------------------------------------------------------------------------
// Main page — synchronous shell, all data streams via Suspense
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  // Pre-kick all fetches in parallel immediately — React.cache() deduplicates
  // these promises so each Suspense boundary gets the already-in-flight result
  // instead of starting a new DB round-trip when React processes the boundary.
  void getCachedDashboardCounts();
  void getCachedAgentList();
  void getCachedBrazeStats();
  void getCachedDashboardTimeSeries();
  void getCachedRecentDecisions();
  void getCachedAllVariantNames();
  void getCachedPersonaDistribution();
  void getCachedFunnelStageBreakdown();

  return (
    <>
      <Header title="Dashboard" description="Nexus platform overview" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Metric cards row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <Suspense fallback={<MetricCardsSkeleton />}>
            <MetricCardsSection />
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

        {/* Funnel breakdown + Persona distribution side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <Suspense fallback={<CardSkeleton />}>
            <FunnelBreakdownSection />
          </Suspense>
          <Suspense fallback={<CardSkeleton />}>
            <PersonaChartSection />
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
