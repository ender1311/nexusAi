export const revalidate = 60;

import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/charts/metric-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PersonaDistributionChart } from "@/components/charts/persona-distribution";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCachedAgentList, getCachedPersonaDistribution, getCachedDashboardCounts, getCachedDashboardTimeSeries, getCachedRecentDecisions } from "@/lib/cache";
import { formatNumber, formatDate } from "@/lib/utils";
import { TimeSeriesPoint, DecisionLog } from "@/types/metrics";
import { Bot, Send, TrendingUp, Users, Plus, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types shared between sub-components
// ---------------------------------------------------------------------------

type AgentSummary = {
  id: string;
  name: string;
  status: string;
  _count: { decisions: number };
};

// ---------------------------------------------------------------------------
// Async sub-components
// ---------------------------------------------------------------------------

async function TimeSeriesSection() {
  const now = new Date();
  const last7Decisions = await getCachedDashboardTimeSeries();

  const byDate = new Map<string, { sends: number; conversions: number }>();
  for (const d of last7Decisions) {
    const key = d.sentAt.slice(0, 10);
    const e = byDate.get(key) ?? { sends: 0, conversions: 0 };
    e.sends++;
    if (d.conversionAt) e.conversions++;
    byDate.set(key, e);
  }

  const last7Days: TimeSeriesPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const { sends, conversions } = byDate.get(key) ?? { sends: 0, conversions: 0 };
    last7Days.push({ date: key, sends, conversions, conversionRate: sends > 0 ? (conversions / sends) * 100 : 0 });
  }

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

async function RecentSendsSection({ agents }: { agents: AgentSummary[] }) {
  const recentDecisionsRaw = await getCachedRecentDecisions();

  const recentSends: DecisionLog[] = recentDecisionsRaw.map((d) => ({
    id: d.id,
    userId: d.userId,
    agentName: agents.find((a) => a.id === d.agentId)?.name ?? "Unknown",
    channel: d.channel,
    variantName: d.variant?.name ?? "—",
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  // Fast queries — counts + lists needed for metric cards and sidebars.
  // last7Decisions is intentionally excluded; TimeSeriesSection fetches it.
  const [agents, personasRaw, dashCounts] = await Promise.all([
    getCachedAgentList(),
    getCachedPersonaDistribution(),
    getCachedDashboardCounts(),
  ]);
  const { sentLast24h, totalDecisions, totalConversions, trackedUsers } = dashCounts;

  // Derived metrics
  const activeAgents = agents.filter((a) => a.status === "active").length;
  const avgConvRate = totalDecisions > 0 ? (totalConversions / totalDecisions) * 100 : 0;

  // Persona distribution (computed from fast data)
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

  const topPersona = personasRaw.slice().sort((a, b) => b._count.trackedUsers - a._count.trackedUsers)[0];

  return (
    <>
      <Header title="Dashboard" description="Nexus platform overview" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Metric cards — render immediately from fast count queries */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <MetricCard
            title="Tracked Users"
            value={formatNumber(trackedUsers)}
            description="synced from Hightouch"
            icon={Users}
          />
          <MetricCard
            title="Active Agents"
            value={activeAgents}
            description="currently running"
            icon={Bot}
            trend={0}
          />
          <MetricCard
            title="Messages Sent (24h)"
            value={formatNumber(sentLast24h)}
            description="across all channels"
            icon={Send}
          />
          <MetricCard
            title="Avg Conversion Rate"
            value={`${avgConvRate.toFixed(2)}%`}
            description="across active agents"
            icon={TrendingUp}
          />
          <MetricCard
            title="Total Sends"
            value={formatNumber(totalDecisions)}
            description="lifetime total"
            icon={Send}
          />
        </div>

        {/* Time series chart (slow — 7-day aggregation) + agents sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <Suspense
            fallback={
              <div className="lg:col-span-2">
                <Card className="lg:col-span-2">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-5 w-20" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-[220px] w-full rounded-md" />
                  </CardContent>
                </Card>
              </div>
            }
          >
            <TimeSeriesSection />
          </Suspense>

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
        </div>

        {/* Recent sends (medium — findMany take:10) + persona sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <Suspense
            fallback={
              <div className="lg:col-span-2">
                <Card className="lg:col-span-2">
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
            <RecentSendsSection agents={agents} />
          </Suspense>

          <div className="space-y-4">
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
          </div>
        </div>
      </div>
    </>
  );
}
