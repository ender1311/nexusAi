export const revalidate = 30;

import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Target, MessageSquare, Calendar, BarChart3, Settings, Users2, GitCompare, Send, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { TestedVariablesBadges } from "@/components/agents/tested-variables-badges";
import { VariantDiffTable } from "@/components/agents/variant-diff-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TestedVariable, MessageVariant, AgentStatus, FunnelStage } from "@/types/agent";
import { prisma } from "@/lib/db";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentFunnelConfig } from "@/components/agents/agent-funnel-config";
import { PersonaTargetManager } from "@/components/agents/persona-target-manager";
import { ArmHealthSection } from "./arm-health-section";
import { FallbackSendTimeEditor } from "@/components/agents/fallback-send-time-editor";
import { AudienceCapEditor } from "@/components/agents/audience-cap-editor";
import { AgentSendsTable } from "@/components/agents/agent-sends-table";
import { AgentNameEditor } from "@/components/agents/agent-name-editor";
import { AgentStatusToggle } from "@/components/agents/agent-status-toggle";
import { AgentEditSheet } from "@/components/agents/agent-edit-sheet";
import { AgentDeleteButton } from "@/components/agents/agent-delete-button";

const TIER_COLORS: Record<string, string> = {
  best:      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  very_good: "bg-green-50 text-green-600 border-green-100 dark:bg-green-900/20 dark:text-green-500 dark:border-green-900",
  good:      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  bad:       "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
  very_bad:  "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  worst:     "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
};

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson Sampling",
  epsilon_greedy: "ε-Greedy",
  contextual: "Contextual Bandit",
};

type FrequencyCap = { maxSends: number; period: string };
type QuietHours = { start: string; end: string; timezone: string };

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [agent, allPersonas] = await Promise.all([
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
    prisma.persona.findMany({
      where: { isActive: true },
      select: { id: true, name: true, icon: true, color: true, description: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!agent) notFound();

  // Count users per target persona for the Audience tab
  const targetPersonaIds = agent.personaTargets.map((pt) => pt.personaId);
  const [userCountRows, previewUsers] = await Promise.all([
    targetPersonaIds.length > 0
      ? prisma.trackedUser.groupBy({
          by: ["personaId"],
          where: { personaId: { in: targetPersonaIds } },
          _count: { personaId: true },
        })
      : Promise.resolve([]),
    // Preview: up to 20 users (display only — independent of audienceCap)
    targetPersonaIds.length > 0
      ? prisma.trackedUser.findMany({
          where: { personaId: { in: targetPersonaIds } },
          select: { externalId: true, personaId: true, attributes: true },
          take: 20,
        })
      : Promise.resolve([]),
  ]);
  const userCountByPersona = new Map(userCountRows.map((r) => [r.personaId, r._count.personaId]));

  const freqCap = agent.schedulingRule?.frequencyCap as FrequencyCap | null;
  const quietHours = agent.schedulingRule?.quietHours as QuietHours | null;
  const blackoutDates = (agent.schedulingRule?.blackoutDates ?? []) as string[];

  // Compute arm health summary
  const activeVariants = agent.messages.flatMap((m) =>
    m.variants
      .filter((v) => v.status === "active")
      .map((v) => ({ id: v.id, name: v.name, warmupUntil: v.warmupUntil })),
  );

  return (
    <>
      <Header
        title={agent.name}
        titleNode={<AgentNameEditor agentId={agent.id} initialName={agent.name} />}
        description={agent.description ?? undefined}
      />
      <div className="p-4 sm:p-6 space-y-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AgentStatusBadge status={agent.status as AgentStatus} />
            <Badge variant="outline" className="text-xs">{algorithmLabels[agent.algorithm] ?? agent.algorithm}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {agent._count.decisions} decisions
            </Badge>
          </div>
          <div className="flex gap-2">
            <AgentEditSheet
              agentId={agent.id}
              initialName={agent.name}
              initialDescription={agent.description ?? null}
              initialAlgorithm={agent.algorithm}
              initialEpsilon={agent.epsilon}
              initialFunnelStage={agent.funnelStage as FunnelStage}
              initialLanguageFilter={agent.languageFilter ?? "all"}
            />
            <AgentStatusToggle agentId={agent.id} status={agent.status} />
            <AgentDeleteButton agentId={agent.id} agentName={agent.name} />
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="overview">
              <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
              Overview
            </TabsTrigger>
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
            <TabsTrigger value="sends">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Sends
            </TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="overview" className="space-y-4 mt-4">
            {agent.status === "draft" && (() => {
              const hasGoals = agent.goals.length > 0;
              const hasMessages = agent.messages.length > 0 && agent.messages.some((m) => m.variants.length > 0);
              const hasScheduling = !!agent.schedulingRule;
              const steps = [
                { label: "Add conversion goals", done: hasGoals, href: `/agents/${agent.id}/goals` },
                { label: "Add message variants", done: hasMessages, href: `/agents/${agent.id}/messages` },
                { label: "Configure scheduling rules", done: hasScheduling, href: `/agents/${agent.id}/scheduling` },
              ];
              const nextStep = steps.find((s) => !s.done);
              return (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2.5 dark:border-amber-800 dark:bg-amber-900/20">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-300">Draft — complete setup before activating</span>
                    </div>
                    {nextStep && (
                      <Link href={nextStep.href}>
                        <Button size="sm" variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0 h-7 text-xs dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/30">
                          {nextStep.label.replace(/^\w/, (c) => c.toUpperCase())} →
                        </Button>
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {steps.map(({ label, done, href }) => (
                      <Link key={href} href={href} className="flex items-center gap-1.5 text-xs hover:underline">
                        <span className={cn("text-base leading-none", done ? "text-green-600" : "text-amber-400")}>
                          {done ? "✓" : "○"}
                        </span>
                        <span className={cn(done ? "text-green-700 dark:text-green-400" : "text-amber-800 dark:text-amber-400")}>{label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })()}
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
                                  className={cn("text-xs ml-2 shrink-0", v.status === "active" ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/30" : "text-yellow-700 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/30")}
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

          <TabsContent value="scheduling" className="mt-4 space-y-4">
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
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Fallback Send Time</CardTitle>
              </CardHeader>
              <CardContent>
                <FallbackSendTimeEditor
                  agentId={agent.id}
                  fallbackSendHour={agent.fallbackSendHour}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Audience Cap</CardTitle>
              </CardHeader>
              <CardContent>
                <AudienceCapEditor
                  agentId={agent.id}
                  audienceCap={agent.audienceCap}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="mt-4 space-y-4">
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <ArmHealthSection agentId={id} activeVariants={activeVariants} />
            </Suspense>
          </TabsContent>

          <TabsContent value="audience" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Target Personas</CardTitle>
                  {targetPersonaIds.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {[...userCountByPersona.values()].reduce((s, n) => s + n, 0).toLocaleString()} eligible users
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <PersonaTargetManager
                  agentId={agent.id}
                  initialTargets={agent.personaTargets.map((pt) => ({
                    id: pt.id,
                    userCount: userCountByPersona.get(pt.personaId) ?? 0,
                    persona: {
                      id: pt.persona.id,
                      name: pt.persona.name,
                      icon: pt.persona.icon,
                      color: pt.persona.color,
                      description: pt.persona.description,
                    },
                  }))}
                  allPersonas={allPersonas}
                />
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
            {previewUsers.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Next Send Preview</CardTitle>
                    <span className="text-xs text-muted-foreground">First {previewUsers.length} eligible users</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">External ID</th>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                        <th className="px-4 py-2 text-left font-medium">Email</th>
                        <th className="px-4 py-2 text-left font-medium">Persona</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewUsers.map((u) => {
                        const attrs = (u.attributes ?? {}) as Record<string, unknown>;
                        const personaName = agent.personaTargets.find((pt) => pt.personaId === u.personaId)?.persona.name ?? "—";
                        return (
                          <tr key={u.externalId} className="border-b last:border-0 hover:bg-muted/40">
                            <td className="px-4 py-2 font-mono text-xs">{u.externalId}</td>
                            <td className="px-4 py-2">{String(attrs.first_name ?? "—")}</td>
                            <td className="px-4 py-2 text-muted-foreground">{String(attrs.email ?? "—")}</td>
                            <td className="px-4 py-2">{personaName}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sends" className="mt-4">
            <AgentSendsTable agentId={agent.id} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
