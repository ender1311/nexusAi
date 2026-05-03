export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/mock/personas";
import { Target, MessageSquare, Calendar, BarChart3, Settings, Play, Pause, Users2, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { TestedVariablesBadges } from "@/components/agents/tested-variables-badges";
import { VariantDiffTable } from "@/components/agents/variant-diff-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TestedVariable, MessageVariant, AgentStatus, FunnelStage } from "@/types/agent";
import { prisma } from "@/lib/db";
import { AgentFunnelConfig } from "@/components/agents/agent-funnel-config";
import { PersonaTargetManager } from "@/components/agents/persona-target-manager";

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

type FrequencyCap = { maxSends: number; period: string };
type QuietHours = { start: string; end: string; timezone: string };

type VariantHealthEntry = {
  variantId: string;
  variantName: string;
  hasStats: boolean;
  totalTries: number;
  inWarmup: boolean;
};

type HealthStatus = "healthy" | "warning" | "critical";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [agent, armHealthData, allPersonas] = await Promise.all([
    prisma.agent.findUnique({
      where: { id },
      include: {
        goals: true,
        messages: { include: { variants: true } },
        schedulingRule: true,
        personaTargets: { include: { persona: true } },
        _count: { select: { decisions: true } },
      },
    }),
    prisma.personaArmStats.findMany({
      where: { agentId: id },
      orderBy: { id: "desc" },
    }),
    prisma.persona.findMany({
      where: { isActive: true },
      select: { id: true, name: true, icon: true, color: true, description: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!agent) notFound();

  const freqCap = agent.schedulingRule?.frequencyCap as FrequencyCap | null;
  const quietHours = agent.schedulingRule?.quietHours as QuietHours | null;
  const blackoutDates = (agent.schedulingRule?.blackoutDates ?? []) as string[];

  // Compute arm health summary
  const activeVariants = agent.messages.flatMap((m) =>
    m.variants
      .filter((v) => v.status === "active")
      .map((v) => ({ id: v.id, name: v.name, warmupUntil: v.warmupUntil })),
  );

  const now = new Date();

  // Accumulate max tries across all personas per variant
  const triesByVariant = new Map<string, number>();
  for (const row of armHealthData) {
    const current = triesByVariant.get(row.variantId) ?? 0;
    if (row.tries > current) triesByVariant.set(row.variantId, row.tries);
  }

  const variantHealth: VariantHealthEntry[] = activeVariants.map((v) => ({
    variantId: v.id,
    variantName: v.name,
    totalTries: triesByVariant.get(v.id) ?? 0,
    hasStats: (triesByVariant.get(v.id) ?? 0) > 0,
    inWarmup: v.warmupUntil !== null && v.warmupUntil > now,
  }));

  const variantsWithStats = variantHealth.filter((v) => v.hasStats).length;
  const variantsInWarmup = variantHealth.filter((v) => v.inWarmup).length;

  let healthStatus: HealthStatus;
  if (activeVariants.length === 0 || variantsWithStats === 0) {
    healthStatus = "critical";
  } else if (variantsWithStats / activeVariants.length < 0.5) {
    healthStatus = "warning";
  } else {
    healthStatus = "healthy";
  }

  return (
    <>
      <Header title={agent.name} description={agent.description ?? undefined} />
      <div className="p-6 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AgentStatusBadge status={agent.status as AgentStatus} />
            <Badge variant="outline" className="text-xs">{algorithmLabels[agent.algorithm] ?? agent.algorithm}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {agent._count.decisions} decisions
            </Badge>
          </div>
          <div className="flex gap-2">
            {(agent.status as AgentStatus) === "active" ? (
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
            {agent.status === "draft" && (
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <p className="text-muted-foreground text-sm">This agent is in draft mode.</p>
                <p className="text-muted-foreground text-xs mt-1">Configure goals and messages, then activate it.</p>
                <Link href={`/agents/${agent.id}/goals`}>
                  <Button className="mt-4" size="sm">Configure Goals</Button>
                </Link>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Goals</p>
                  <p className="text-2xl font-bold mt-1">{agent.goals.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Messages</p>
                  <p className="text-2xl font-bold mt-1">{agent.messages.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Total Decisions</p>
                  <p className="text-2xl font-bold mt-1">{agent._count.decisions}</p>
                </CardContent>
              </Card>
            </div>
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
                {agent.goals.length > 0 ? (
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
                {agent.messages.length > 0 ? (
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
                                  <VariantDiffTable variants={(msg.variants ?? []) as unknown as MessageVariant[]} />
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
                {freqCap && quietHours ? (
                  <div className="space-y-3">
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Frequency Cap</span>
                      <span className="text-sm font-medium">
                        {freqCap.maxSends}x per {freqCap.period}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Quiet Hours</span>
                      <span className="text-sm font-medium">
                        {quietHours.start}–{quietHours.end}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Timezone</span>
                      <span className="text-sm font-medium">{quietHours.timezone}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Smart Suppression</span>
                      <span className="text-sm font-medium">
                        {agent.schedulingRule?.smartSuppress
                          ? `Enabled (≥${((agent.schedulingRule.suppressThresh ?? 0.5) * 100).toFixed(0)}%)`
                          : "Disabled"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-sm text-muted-foreground">Blackout Dates</span>
                      <span className="text-sm font-medium">
                        {blackoutDates.length > 0 ? blackoutDates.join(", ") : "None"}
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
            {/* Arm health summary */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Arm Health</CardTitle>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs capitalize",
                      healthStatus === "healthy"
                        ? "text-green-700 bg-green-50 border-green-200"
                        : healthStatus === "warning"
                          ? "text-amber-700 bg-amber-50 border-amber-200"
                          : "text-red-700 bg-red-50 border-red-200",
                    )}
                  >
                    {healthStatus}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  {[
                    { label: "Active Variants", value: activeVariants.length },
                    { label: "With Stats", value: variantsWithStats },
                    { label: "In Warmup", value: variantsInWarmup },
                    { label: "No Stats", value: activeVariants.length - variantsWithStats },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <p className="text-xl font-bold">{value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {variantHealth.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No active variants.</p>
                ) : (
                  <div className="space-y-2">
                    {variantHealth.map((v) => (
                      <div
                        key={v.variantId}
                        className="flex items-center justify-between p-2 border rounded-md"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "h-2 w-2 rounded-full",
                              v.hasStats ? "bg-green-500" : "bg-muted-foreground/30",
                            )}
                          />
                          <span className="text-sm">{v.variantName}</span>
                          {v.inWarmup && (
                            <Badge
                              variant="outline"
                              className="text-xs text-amber-700 bg-amber-50 border-amber-200"
                            >
                              warmup
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          {v.totalTries} tries
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audience" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Target Personas</CardTitle>
              </CardHeader>
              <CardContent>
                {agent.personaTargets.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {agent.personaTargets.map(({ persona }) => {
                      const colors = PERSONA_COLORS[persona.color] ?? PERSONA_COLORS.blue;
                      const Icon = PERSONA_ICON_MAP[persona.icon];
                      return (
                        <div key={persona.id} className={cn("border rounded-lg p-3 space-y-2", colors.border, colors.bg)}>
                          <div className="flex items-center gap-2">
                            <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", colors.iconBg)}>
                              {Icon ? (
                                <Icon className={cn("h-4 w-4", colors.text)} />
                              ) : (
                                <span className={cn("text-xs font-bold", colors.text)}>
                                  {persona.name.slice(0, 2).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{persona.name}</p>
                              <p className={cn("text-xs", colors.text)}>{persona.description?.slice(0, 40)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No target personas configured.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Funnel Stage &amp; Targeting</CardTitle>
              </CardHeader>
              <CardContent>
                <AgentFunnelConfig
                  agentId={agent.id}
                  funnelStage={agent.funnelStage as FunnelStage}
                  targetFilter={
                    agent.targetFilter !== null &&
                    typeof agent.targetFilter === "object" &&
                    !Array.isArray(agent.targetFilter)
                      ? (agent.targetFilter as Record<string, unknown>)
                      : null
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
