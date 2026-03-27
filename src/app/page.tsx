import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/charts/metric-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PersonaDistributionChart } from "@/components/charts/persona-distribution";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mockAgents } from "@/lib/mock/agents";
import { mockPersonas } from "@/lib/mock/personas";
import { globalTimeSeries, agentMetrics, recentDecisions } from "@/lib/mock/metrics";
import { formatNumber, formatDate } from "@/lib/utils";
import { Bot, Send, TrendingUp, Users, Plus, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const activeAgents = mockAgents.filter((a) => a.status === "active").length;
  const totalSent24h = globalTimeSeries.slice(-1)[0]?.sends ?? 0;
  const avgConvRate = agentMetrics.reduce((s, m) => s + m.conversionRate, 0) / agentMetrics.length;
  const totalDecisions = mockAgents.reduce((s, a) => s + (a._count?.decisions ?? 0), 0);

  const last7Days = globalTimeSeries.slice(-7);
  const topPersona = mockPersonas.slice().sort((a, b) => (b.metrics?.ltv ?? 0) - (a.metrics?.ltv ?? 0))[0];

  return (
    <>
      <Header title="Dashboard" description="Nexus platform overview" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Active Agents"
            value={activeAgents}
            description="of 4 total agents"
            icon={Bot}
            trend={0}
          />
          <MetricCard
            title="Messages Sent (24h)"
            value={formatNumber(totalSent24h)}
            description="across all channels"
            icon={Send}
            trend={3.2}
          />
          <MetricCard
            title="Avg Conversion Rate"
            value={`${avgConvRate.toFixed(2)}%`}
            description="vs 5.2% control baseline"
            icon={TrendingUp}
            trend={24.1}
          />
          <MetricCard
            title="Decisions Made"
            value={formatNumber(totalDecisions)}
            description="lifetime total"
            icon={Users}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Conversion Rate (7 days)</CardTitle>
              <Badge variant="outline" className="text-xs">All Agents</Badge>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart data={last7Days} height={220} showSends />
            </CardContent>
          </Card>

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
              {mockAgents.map((agent) => {
                const metric = agentMetrics.find((m) => m.agentId === agent.id);
                return (
                  <Link key={agent.id} href={`/agents/${agent.id}`}>
                    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{agent.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{agent.status}</p>
                      </div>
                      {metric ? (
                        <span className="text-xs font-bold text-primary ml-2">
                          {metric.conversionRate.toFixed(1)}%
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-xs">Draft</Badge>
                      )}
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recent Decisions</CardTitle>
              <Link href="/performance">
                <Button variant="ghost" size="sm" className="h-7 text-xs">View all</Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {recentDecisions.slice(0, 10).map((d) => (
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
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Persona Distribution</CardTitle>
                <Link href="/personas">
                  <Button variant="ghost" size="sm" className="h-7 text-xs">View all</Button>
                </Link>
              </CardHeader>
              <CardContent>
                <PersonaDistributionChart />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Top Persona</CardTitle>
              </CardHeader>
              <CardContent>
                {topPersona && (
                  <Link href={`/personas/${topPersona.id}`}>
                    <div className="hover:bg-muted rounded-lg p-2 -m-2 transition-colors">
                      <p className="text-sm font-medium">{topPersona.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{topPersona.label} · {topPersona.engagement?.label}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs"><span className="font-semibold text-primary">{topPersona.metrics?.conversionRate}%</span> conv.</span>
                        <span className="text-xs"><span className="font-semibold">LTV {topPersona.metrics?.ltv}/10</span></span>
                        <span className="text-xs text-muted-foreground">{formatNumber(topPersona.metrics?.userCount ?? 0)} users</span>
                      </div>
                    </div>
                  </Link>
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

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Top Performer</CardTitle>
              </CardHeader>
              <CardContent>
                {agentMetrics
                  .slice()
                  .sort((a, b) => b.liftVsControl - a.liftVsControl)
                  .slice(0, 1)
                  .map((m) => (
                    <div key={m.agentId}>
                      <p className="text-sm font-medium">{m.agentName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="text-green-600 font-semibold">+{m.liftVsControl}%</span> lift vs control
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.conversionRate.toFixed(2)}% conversion rate
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
