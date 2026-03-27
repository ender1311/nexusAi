import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockAgents } from "@/lib/mock/agents";
import { mockPersonas, PERSONA_COLORS, PERSONA_ICON_MAP, personaAgentMetrics } from "@/lib/mock/personas";
import { agentMetrics, variantMetrics, agentTimeSeries } from "@/lib/mock/metrics";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { ExplorationRatio } from "@/components/charts/exploration-ratio";
import { formatNumber } from "@/lib/utils";
import { Target, MessageSquare, Calendar, BarChart3, Settings, Play, Pause, Users2, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { TestedVariablesBadges } from "@/components/agents/tested-variables-badges";
import { VariantDiffTable } from "@/components/agents/variant-diff-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TestedVariable, MessageVariant } from "@/types/agent";

const TIER_COLORS: Record<string, string> = {
  best: "bg-green-100 text-green-700 border-green-200",
  very_good: "bg-green-50 text-green-600 border-green-100",
  good: "bg-blue-100 text-blue-700 border-blue-200",
  bad: "bg-yellow-100 text-yellow-700 border-yellow-200",
  very_bad: "bg-orange-100 text-orange-700 border-orange-200",
  worst: "bg-red-100 text-red-700 border-red-200",
};

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson Sampling",
  epsilon_greedy: "ε-Greedy",
  contextual: "Contextual Bandit",
};

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = mockAgents.find((a) => a.id === id);
  if (!agent) notFound();

  const metric = agentMetrics.find((m) => m.agentId === id);
  const variants = variantMetrics[id] ?? [];
  const timeSeries = agentTimeSeries[id] ?? [];
  const audiencePersonas = (agent.targetPersonaIds ?? [])
    .map((pid) => mockPersonas.find((p) => p.id === pid))
    .filter(Boolean);
  const agentPersonaMetrics = personaAgentMetrics[id] ?? [];

  return (
    <>
      <Header title={agent.name} description={agent.description ?? undefined} />
      <div className="p-6 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AgentStatusBadge status={agent.status} />
            <Badge variant="outline" className="text-xs">{algorithmLabels[agent.algorithm]}</Badge>
            {metric && (
              <Badge variant="outline" className="text-xs text-green-700 bg-green-50">
                {metric.conversionRate.toFixed(2)}% conv rate
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {agent.status === "active" ? (
              <Button variant="outline" size="sm">
                <Pause className="h-3.5 w-3.5 mr-1.5" />
                Pause
              </Button>
            ) : (
              <Button size="sm">
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Activate
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {metric && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total Sends</p>
                <p className="text-xl font-bold mt-1">{formatNumber(metric.sends)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Conversions</p>
                <p className="text-xl font-bold mt-1">{formatNumber(metric.conversions)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Conv. Rate</p>
                <p className="text-xl font-bold mt-1 text-primary">{metric.conversionRate.toFixed(2)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Lift vs Control</p>
                <p className="text-xl font-bold mt-1 text-green-600">+{metric.liftVsControl}%</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="goals">
              <Target className="h-3.5 w-3.5 mr-1.5" />
              Goals
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Messages
            </TabsTrigger>
            <TabsTrigger value="scheduling">
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              Scheduling
            </TabsTrigger>
            <TabsTrigger value="performance">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="audience">
              <Users2 className="h-3.5 w-3.5 mr-1.5" />
              Audience
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {timeSeries.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Conversion Rate (30 days)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TimeSeriesChart data={timeSeries} height={200} />
                  </CardContent>
                </Card>
              )}
              {variants.length > 0 && metric && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Explore/Deliver</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ExplorationRatio explorePercent={metric.exploreRatio} />
                  </CardContent>
                </Card>
              )}
            </div>
            {agent.status === "draft" && (
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <p className="text-muted-foreground text-sm">This agent is in draft mode.</p>
                <p className="text-muted-foreground text-xs mt-1">Configure goals and messages, then activate it.</p>
                <Link href={`/agents/${agent.id}/goals`}>
                  <Button className="mt-4" size="sm">Configure Goals</Button>
                </Link>
              </div>
            )}
          </TabsContent>

          <TabsContent value="goals" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Conversion Goals</CardTitle>
                <Link href={`/agents/${agent.id}/goals`}>
                  <Button size="sm" variant="outline">
                    <Settings className="h-3.5 w-3.5 mr-1.5" />
                    Manage
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {agent.goals && agent.goals.length > 0 ? (
                  <div className="space-y-2">
                    {agent.goals.map((g) => (
                      <div key={g.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">{g.eventName}</p>
                          {g.description && <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-xs capitalize", TIER_COLORS[g.tier] ?? "")}>
                            {g.tier.replace("_", " ")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">w: {g.valueWeight}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No goals configured.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messages" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Messages & Variants</CardTitle>
                <Link href={`/agents/${agent.id}/messages`}>
                  <Button size="sm" variant="outline">
                    <Settings className="h-3.5 w-3.5 mr-1.5" />
                    Manage
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {agent.messages && agent.messages.length > 0 ? (
                  <div className="space-y-4">
                    {agent.messages.map((msg) => {
                      const testedVars = (msg.testedVariables ?? []) as TestedVariable[];
                      return (
                        <div key={msg.id} className="border rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <p className="text-sm font-semibold">{msg.name}</p>
                            <Badge variant="outline" className="text-xs capitalize">{msg.channel}</Badge>
                            {msg.brazeCampaignId && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Braze: {msg.brazeCampaignId}
                              </Badge>
                            )}
                            {(msg.variants?.length ?? 0) >= 2 && (
                              <Dialog>
                                <DialogTrigger render={
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs ml-auto">
                                    <GitCompare className="h-3 w-3 mr-1" />
                                    Compare
                                  </Button>
                                } />
                                <DialogContent className="max-w-3xl">
                                  <DialogHeader>
                                    <DialogTitle className="text-sm">{msg.name} — Variant Comparison</DialogTitle>
                                  </DialogHeader>
                                  <VariantDiffTable variants={(msg.variants ?? []) as MessageVariant[]} />
                                </DialogContent>
                              </Dialog>
                            )}
                          </div>
                          {testedVars.length > 0 && (
                            <div className="mb-2">
                              <TestedVariablesBadges variables={testedVars} />
                            </div>
                          )}
                          <div className="space-y-2">
                            {msg.variants?.map((v) => (
                              <div key={v.id} className="flex items-start justify-between p-2 bg-muted/50 rounded-md">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium">{v.name}</p>
                                  {v.subject && <p className="text-xs text-muted-foreground">Subj: {v.subject}</p>}
                                  {msg.channel === "push" && v.title && (
                                    <p className="text-xs text-muted-foreground">Title: {v.title}</p>
                                  )}
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{v.body}</p>
                                  {msg.channel === "push" && v.deeplink && (
                                    <p className="text-xs text-muted-foreground truncate">Link: {v.deeplink}</p>
                                  )}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn("text-xs ml-2 shrink-0", v.status === "active" ? "text-green-700 bg-green-50" : "text-yellow-700 bg-yellow-50")}
                                >
                                  {v.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No messages configured.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scheduling" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Scheduling Rules</CardTitle>
                <Link href={`/agents/${agent.id}/scheduling`}>
                  <Button size="sm" variant="outline">
                    <Settings className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {agent.schedulingRule ? (
                  <div className="space-y-3">
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Frequency Cap</span>
                      <span className="text-sm font-medium">
                        {agent.schedulingRule.frequencyCap.maxSends}x per {agent.schedulingRule.frequencyCap.period}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Quiet Hours</span>
                      <span className="text-sm font-medium">
                        {agent.schedulingRule.quietHours.start}–{agent.schedulingRule.quietHours.end}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Timezone</span>
                      <span className="text-sm font-medium">{agent.schedulingRule.quietHours.timezone}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Smart Suppression</span>
                      <span className="text-sm font-medium">
                        {agent.schedulingRule.smartSuppress
                          ? `Enabled (≥${(agent.schedulingRule.suppressThresh * 100).toFixed(0)}%)`
                          : "Disabled"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-sm text-muted-foreground">Blackout Dates</span>
                      <span className="text-sm font-medium">
                        {agent.schedulingRule.blackoutDates.length > 0
                          ? agent.schedulingRule.blackoutDates.join(", ")
                          : "None"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No scheduling rules configured.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="mt-4 space-y-4">
            {timeSeries.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Conversion Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <TimeSeriesChart data={timeSeries} height={240} showSends />
                </CardContent>
              </Card>
            )}
            {variants.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Variant Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <VariantComparison variants={variants} />
                </CardContent>
              </Card>
            )}
            {timeSeries.length === 0 && variants.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">No performance data yet. Activate this agent to start collecting data.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="audience" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Target Personas</CardTitle>
              </CardHeader>
              <CardContent>
                {audiencePersonas.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {audiencePersonas.map((persona) => {
                      if (!persona) return null;
                      const colors = PERSONA_COLORS[persona.color];
                      const Icon = PERSONA_ICON_MAP[persona.icon];
                      const pMetric = agentPersonaMetrics.find((m) => m.personaId === persona.id);
                      return (
                        <div key={persona.id} className={cn("border rounded-lg p-3 space-y-2", colors.border, colors.bg)}>
                          <div className="flex items-center gap-2">
                            <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", colors.iconBg)}>
                              {Icon && <Icon className={cn("h-4 w-4", colors.text)} />}
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{persona.name}</p>
                              <p className={cn("text-xs", colors.text)}>{persona.label}</p>
                            </div>
                          </div>
                          {pMetric ? (
                            <div className="grid grid-cols-3 gap-1 pt-1 border-t border-current/10">
                              <div>
                                <p className="text-xs text-muted-foreground">Sends</p>
                                <p className="text-sm font-semibold">{(pMetric.sends / 1000).toFixed(1)}K</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Conv.</p>
                                <p className="text-sm font-semibold">{pMetric.conversionRate}%</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Lift</p>
                                <p className={cn("text-sm font-semibold", pMetric.lift >= 0 ? "text-green-600" : "text-red-500")}>
                                  {pMetric.lift >= 0 ? "+" : ""}{pMetric.lift}%
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No data yet</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No target personas configured. Edit this agent to add persona targeting.
                  </p>
                )}
              </CardContent>
            </Card>

            {agentPersonaMetrics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Per-Persona Performance Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2 pb-2 border-b text-xs text-muted-foreground font-medium">
                      <span>Persona</span>
                      <span className="text-right">Sends</span>
                      <span className="text-right">Conv. Rate</span>
                      <span className="text-right">Lift</span>
                    </div>
                    {agentPersonaMetrics
                      .slice()
                      .sort((a, b) => b.conversionRate - a.conversionRate)
                      .map((row) => {
                        const persona = mockPersonas.find((p) => p.id === row.personaId);
                        return (
                          <div key={row.personaId} className="grid grid-cols-4 gap-2 py-2 border-b last:border-0 text-sm">
                            <span className="font-medium truncate">{persona?.name ?? row.personaId}</span>
                            <span className="text-right text-muted-foreground">{(row.sends / 1000).toFixed(1)}K</span>
                            <span className="text-right font-semibold text-primary">{row.conversionRate}%</span>
                            <span className={cn("text-right font-semibold", row.lift >= 0 ? "text-green-600" : "text-red-500")}>
                              {row.lift >= 0 ? "+" : ""}{row.lift}%
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
