export const revalidate = 900;

import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Target, MessageSquare, BarChart3, Settings, Users2, GitCompare, Send, LayoutDashboard, Languages, Sliders } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { TestedVariablesBadges } from "@/components/agents/tested-variables-badges";
import { VariantDiffTable } from "@/components/agents/variant-diff-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TestedVariable, MessageVariant, AgentStatus, FunnelStage } from "@/types/agent";
import { getCachedAgent, getCachedActivePersonas, getCachedAgentAudienceData, getCachedAgentDecisionSplit } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { VERSE_PUSH_SENTINEL } from "@/lib/verse-content";
import { getAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentFunnelConfig } from "@/components/agents/agent-funnel-config";
import { PersonaTargetManager } from "@/components/agents/persona-target-manager";
import { ArmHealthSection } from "./arm-health-section";
import { CurrentWinnerCard } from "./current-winner-card";
import { AgentSendsTable } from "@/components/agents/agent-sends-table";
import { AgentSettingsEditor } from "@/components/agents/agent-settings-editor";
import { AgentNameEditor } from "@/components/agents/agent-name-editor";
import { AgentStatusToggle } from "@/components/agents/agent-status-toggle";
import { AgentPauseToggle } from "@/components/agents/agent-pause-toggle";
import { AgentEditSheet } from "@/components/agents/agent-edit-sheet";
import { AgentDeleteButton } from "@/components/agents/agent-delete-button";
import { ReleaseAllButton } from "@/components/agents/release-all-button";
import { AgentLocalizationTab } from "@/components/agents/agent-localization-tab";

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
  linucb: "LinUCB",
};

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; edit?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, edit: editParam } = await searchParams;
  // Map legacy ?tab=scheduling links to the unified settings tab.
  const activeTab = tabParam === "scheduling" ? "settings" : (tabParam ?? "overview");

  const [agent, allPersonas, { isAdmin }] = await Promise.all([
    getCachedAgent(id),
    getCachedActivePersonas(),
    getAuth(),
  ]);

  if (!agent) notFound();

  // Admin-only: colors of other agents feed the edit sheet's color picker.
  // Non-admins never see the sheet, so skip the query entirely for them.
  const usedColors = isAdmin
    ? (await prisma.agent.findMany({ where: { id: { not: id } }, select: { color: true } })).map((a) => a.color)
    : [];

  // Compute arm health summary
  const activeVariants = agent.messages.flatMap((m) =>
    m.variants
      .filter((v) => v.status === "active")
      .map((v) => ({ id: v.id, name: v.name, warmupUntil: v.warmupUntil })),
  );

  const hasVerseVariants = agent.messages.some((m) =>
    m.channel === "push" && m.variants.some((v) => v.body === VERSE_PUSH_SENTINEL),
  );

  return (
    <>
      <Header
        title={agent.name}
        titleNode={isAdmin ? <AgentNameEditor agentId={agent.id} initialName={agent.name} /> : undefined}
        description={agent.description ?? undefined}
      />
      <div className="p-4 sm:p-6 space-y-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AgentStatusBadge status={agent.status as AgentStatus} />
            <Badge variant="outline" className="text-xs">{algorithmLabels[agent.algorithm] ?? agent.algorithm}</Badge>
            <Suspense fallback={<Skeleton className="h-5 w-16 rounded-full" />}>
              <SentCountBadges agentId={agent.id} />
            </Suspense>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <AgentEditSheet
                agentId={agent.id}
                initialName={agent.name}
                initialDescription={agent.description ?? null}
                initialAlgorithm={agent.algorithm}
                initialEpsilon={agent.epsilon}
                initialFunnelStage={agent.funnelStage as FunnelStage}
                initialColor={agent.color ?? "#6366f1"}
                usedColors={usedColors}
                initialTargetSegmentName={agent.targetSegmentName ?? null}
                initialSegmentTargeting={
                  (agent.segmentTargeting as { includes: string[]; excludes: string[] } | null) ?? null
                }
                initialDailySendCap={agent.dailySendCap ?? null}
                initialDeeplinkOverride={agent.deeplinkOverride ?? null}
                hasVerseVariants={hasVerseVariants}
              />
            )}
            {isAdmin && <AgentStatusToggle agentId={agent.id} status={agent.status} />}
            {isAdmin && (
              <AgentPauseToggle
                agentId={agent.id}
                agentName={agent.name}
                sendingPaused={agent.sendingPaused}
              />
            )}
            {isAdmin && <AgentDeleteButton agentId={agent.id} agentName={agent.name} />}
            {isAdmin && <ReleaseAllButton agentId={agent.id} />}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={activeTab}>
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="overview">
              <LayoutDashboard className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="goals">
              <Target className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Goals</span>
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Messages</span>
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Sliders className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
            <TabsTrigger value="localization">
              <Languages className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Localization</span>
            </TabsTrigger>
            <TabsTrigger value="performance">
              <BarChart3 className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Performance</span>
            </TabsTrigger>
            <TabsTrigger value="audience">
              <Users2 className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Audience</span>
            </TabsTrigger>
            <TabsTrigger value="sends">
              <Send className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Sends</span>
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
            <Suspense fallback={null}>
              <CurrentWinnerCard agentId={agent.id} activeVariants={activeVariants} />
            </Suspense>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Goals</p>
                  <p className="text-2xl font-bold mt-1">{agent.goals.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Variants</p>
                  <p className="text-2xl font-bold mt-1">{agent.messages.flatMap((m) => m.variants).length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Messages Sent</p>
                  <Suspense fallback={<Skeleton className="h-8 w-16 mt-1" />}>
                    <MessagesSentValue agentId={agent.id} />
                  </Suspense>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Daily Send Cap</p>
                  <p className="text-2xl font-bold mt-1">
                    {agent.dailySendCap != null ? formatNumber(agent.dailySendCap) : "∞"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Unique Users Cap</p>
                  <p className="text-2xl font-bold mt-1">
                    {agent.uniqueUsersCap != null ? formatNumber(agent.uniqueUsersCap) : "∞"}
                  </p>
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
                                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl overflow-x-auto">
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
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate">Body: {v.body}</p>
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

          <TabsContent value="settings" className="mt-4">
            {isAdmin ? (
              <AgentSettingsEditor
                agent={{
                  id: agent.id,
                  name: agent.name,
                  description: agent.description ?? null,
                  color: agent.color ?? "#6366f1",
                  algorithm: agent.algorithm,
                  epsilon: agent.epsilon,
                  funnelStage: agent.funnelStage as FunnelStage,
                  targetSegmentName: agent.targetSegmentName ?? null,
                  segmentTargeting:
                    (agent.segmentTargeting as { includes: string[]; excludes: string[] } | null) ?? null,
                  enrollmentMode: (agent.enrollmentMode === "continuous" ? "continuous" : "fixed"),
                  dailySendCap: agent.dailySendCap ?? null,
                  uniqueUsersCap: agent.uniqueUsersCap ?? null,
                  fallbackSendHour: agent.fallbackSendHour ?? null,
                  deeplinkOverride: agent.deeplinkOverride ?? null,
                  languageFilter: agent.languageFilter ?? "all",
                  localizePush: agent.localizePush ?? false,
                  hasVerseVariants,
                  usedColors,
                }}
                initialRule={agent.schedulingRule ? {
                  ...agent.schedulingRule,
                  frequencyCap: agent.schedulingRule.frequencyCap as unknown as import("@/types/agent").FrequencyCap,
                  quietHours: agent.schedulingRule.quietHours as unknown as import("@/types/agent").QuietHours,
                  blackoutDates: (agent.schedulingRule.blackoutDates ?? []) as string[],
                } : null}
                startInEditMode={editParam === "1"}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Admin access required to view or edit settings.
              </p>
            )}
          </TabsContent>

          <TabsContent value="localization" className="mt-4">
            <AgentLocalizationTab agentId={agent.id} initialLocalizePush={agent.localizePush} />
          </TabsContent>

          <TabsContent value="performance" className="mt-4 space-y-4">
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <ArmHealthSection agentId={id} activeVariants={activeVariants} />
            </Suspense>
          </TabsContent>

          <TabsContent value="audience" className="mt-4">
            <Suspense fallback={
              <div className="space-y-4">
                <Skeleton className="h-40 rounded-xl" />
                <Skeleton className="h-32 rounded-xl" />
              </div>
            }>
              <AudienceTabContent
                agentId={id}
                personaTargets={agent.personaTargets}
                funnelStage={agent.funnelStage as FunnelStage}
                targetFilter={
                  agent.targetFilter !== null &&
                  typeof agent.targetFilter === "object" &&
                  !Array.isArray(agent.targetFilter)
                    ? (agent.targetFilter as Record<string, unknown>)
                    : null
                }
                targetSegmentName={agent.targetSegmentName ?? null}
                segmentTargeting={
                  (agent.segmentTargeting as { includes: string[]; excludes: string[] } | null) ?? null
                }
                allPersonas={allPersonas}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="sends" className="mt-4">
            <AgentSendsTable agentId={agent.id} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

/** Top-bar "N sent" + optional "N scheduled" badges — streamed so the slow
 *  UserDecision count doesn't block the agent shell. */
async function SentCountBadges({ agentId }: { agentId: string }) {
  const { delivered, pending } = await getCachedAgentDecisionSplit(agentId);
  return (
    <>
      <Badge variant="outline" className="text-xs text-muted-foreground">
        {formatNumber(delivered)} sent
      </Badge>
      {pending > 0 && (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {formatNumber(pending)} scheduled
        </Badge>
      )}
    </>
  );
}

/** Overview "Messages Sent" card value — same streamed count as the top bar. */
async function MessagesSentValue({ agentId }: { agentId: string }) {
  const { delivered, pending } = await getCachedAgentDecisionSplit(agentId);
  return (
    <>
      <p className="text-2xl font-bold mt-1">{formatNumber(delivered)}</p>
      {pending > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          +{formatNumber(pending)} scheduled
        </p>
      )}
    </>
  );
}

type AudiencePersonaTarget = {
  id: string;
  personaId: string;
  persona: { id: string; name: string; label: string | null; icon: string | null; color: string | null };
};

async function AudienceTabContent({
  agentId,
  personaTargets,
  funnelStage,
  targetFilter,
  targetSegmentName,
  segmentTargeting,
  allPersonas,
}: {
  agentId: string;
  personaTargets: AudiencePersonaTarget[];
  funnelStage: FunnelStage;
  targetFilter: Record<string, unknown> | null;
  targetSegmentName: string | null;
  segmentTargeting: { includes: string[]; excludes: string[] } | null;
  allPersonas: Awaited<ReturnType<typeof getCachedActivePersonas>>;
}) {
  // ── Multi-segment mode (new segmentTargeting field) ───────────────────────────
  const hasMultiSegment = (segmentTargeting?.includes?.length ?? 0) > 0;
  if (hasMultiSegment && segmentTargeting) {
    const [includeAggs, excludeAggs] = await Promise.all([
      Promise.all(segmentTargeting.includes.map((seg) =>
        prisma.userSegment.aggregate({
          where: { segmentName: seg },
          _count: { _all: true },
          _max: { syncedAt: true },
        }).then((r) => ({ seg, count: r._count._all, lastSynced: r._max.syncedAt }))
      )),
      segmentTargeting.excludes.length > 0
        ? Promise.all(segmentTargeting.excludes.map((seg) =>
            prisma.userSegment.aggregate({
              where: { segmentName: seg },
              _count: { _all: true },
              _max: { syncedAt: true },
            }).then((r) => ({ seg, count: r._count._all, lastSynced: r._max.syncedAt }))
          ))
        : Promise.resolve([] as { seg: string; count: number; lastSynced: Date | null }[]),
    ]);

    const STALE_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const allAggs = [...includeAggs, ...excludeAggs];
    const isAnyStale = allAggs.some((a) => !a.lastSynced || now.getTime() - a.lastSynced.getTime() > STALE_MS);

    // Preview members from the first include segment
    const firstIncludeSeg = segmentTargeting.includes[0];
    const rawMembers = await prisma.userSegment.findMany({
      where: { segmentName: firstIncludeSeg },
      select: { externalId: true },
      take: 20,
      orderBy: { syncedAt: "desc" },
    });
    const memberDetails = rawMembers.length > 0
      ? await prisma.trackedUser.findMany({
          where: { externalId: { in: rawMembers.map((m) => m.externalId) } },
          select: { externalId: true, personaId: true },
        })
      : [];

    const personaById = new Map(allPersonas.map((p) => [p.id, p.name]));

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Hightouch Segment Targeting</CardTitle>
              {isAnyStale && (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  <span className="text-base leading-none">⚠</span>
                  Stale — sync overdue
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Include (AND)</p>
              <div className="space-y-2">
                {includeAggs.map(({ seg, count, lastSynced }) => {
                  const stale = !lastSynced || now.getTime() - lastSynced.getTime() > STALE_MS;
                  return (
                    <div key={seg} className="flex items-center justify-between py-2 border-b last:border-0">
                      <span className="text-sm font-mono font-medium">{seg}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{count.toLocaleString()} members</span>
                        <span className={cn("text-xs", stale ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                          {lastSynced
                            ? lastSynced.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
                            : "Never"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {excludeAggs.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Exclude (NOT IN)</p>
                <div className="space-y-2">
                  {excludeAggs.map(({ seg, count, lastSynced }) => {
                    const stale = !lastSynced || now.getTime() - lastSynced.getTime() > STALE_MS;
                    return (
                      <div key={seg} className="flex items-center justify-between py-2 border-b last:border-0">
                        <span className="text-sm font-mono font-medium text-destructive/80">{seg}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">{count.toLocaleString()} members</span>
                          <span className={cn("text-xs", stale ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                            {lastSynced
                              ? lastSynced.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
                              : "Never"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {memberDetails.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Segment Member Preview</CardTitle>
                <span className="text-xs text-muted-foreground">From &quot;{firstIncludeSeg}&quot; — most recently synced {memberDetails.length}</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">External ID</th>
                    <th className="px-4 py-2 text-left font-medium">Persona</th>
                  </tr>
                </thead>
                <tbody>
                  {memberDetails.map((u) => (
                    <tr key={u.externalId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs max-w-[100px] truncate">{u.externalId}</td>
                      <td className="px-4 py-2 max-w-[90px] truncate text-muted-foreground text-xs">
                        {u.personaId ? (personaById.get(u.personaId) ?? u.personaId) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── Legacy single-segment mode ────────────────────────────────────────────────
  if (targetSegmentName) {
    const STALE_MS = 24 * 60 * 60 * 1000;
    const now = new Date();

    const [segmentAgg, rawMembers] = await Promise.all([
      prisma.userSegment.aggregate({
        where: { segmentName: targetSegmentName },
        _count: { _all: true },
        _max: { syncedAt: true },
      }),
      prisma.userSegment.findMany({
        where: { segmentName: targetSegmentName },
        select: { externalId: true },
        take: 20,
        orderBy: { syncedAt: "desc" },
      }),
    ]);

    const memberCount = segmentAgg._count._all;
    const lastSynced = segmentAgg._max.syncedAt;
    const isStale = !lastSynced || now.getTime() - lastSynced.getTime() > STALE_MS;

    const memberDetails = rawMembers.length > 0
      ? await prisma.trackedUser.findMany({
          where: { externalId: { in: rawMembers.map((m) => m.externalId) } },
          select: { externalId: true, personaId: true },
        })
      : [];

    const personaById = new Map(allPersonas.map((p) => [p.id, p.name]));

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Hightouch Segment</CardTitle>
              {isStale && (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  <span className="text-base leading-none">⚠</span>
                  Stale — sync overdue
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Segment name</span>
              <span className="text-sm font-mono font-medium">{targetSegmentName}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Members (DB count)</span>
              <span className="text-sm font-medium">{memberCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-muted-foreground">Last synced</span>
              <span className={cn("text-sm", isStale ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                {lastSynced
                  ? lastSynced.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
                  : "Never"}
              </span>
            </div>
          </CardContent>
        </Card>

        {memberDetails.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Segment Member Preview</CardTitle>
                <span className="text-xs text-muted-foreground">Most recently synced {memberDetails.length}</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">External ID</th>
                    <th className="px-4 py-2 text-left font-medium">Persona</th>
                  </tr>
                </thead>
                <tbody>
                  {memberDetails.map((u) => (
                    <tr key={u.externalId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs max-w-[100px] truncate">{u.externalId}</td>
                      <td className="px-4 py-2 max-w-[90px] truncate text-muted-foreground text-xs">
                        {u.personaId ? (personaById.get(u.personaId) ?? u.personaId) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── Funnel-stage mode ─────────────────────────────────────────────────────────
  const targetPersonaIds = personaTargets.map((pt) => pt.personaId);
  const { userCountRows, previewUsers } = await getCachedAgentAudienceData(agentId, targetPersonaIds);
  const userCountByPersona = new Map(userCountRows.map((r) => [r.personaId, r._count.personaId]));

  return (
    <div className="space-y-4">
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
            agentId={agentId}
            initialTargets={personaTargets.map((pt) => ({
              id: pt.id,
              userCount: userCountByPersona.get(pt.personaId) ?? 0,
              persona: {
                id: pt.persona.id,
                name: pt.persona.name,
                label: pt.persona.label,
                icon: pt.persona.icon ?? "",
                color: pt.persona.color ?? "",
              },
            }))}
            allPersonas={allPersonas.map((p) => ({
              id: p.id,
              name: p.name,
              label: p.label,
              icon: p.icon ?? "",
              color: p.color ?? "",
            }))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Funnel Stage &amp; Targeting</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentFunnelConfig
            agentId={agentId}
            funnelStage={funnelStage}
            targetFilter={targetFilter}
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
                  <th className="px-4 py-2 text-left font-medium">Persona</th>
                </tr>
              </thead>
              <tbody>
                {previewUsers.map((u) => {
                  const personaName = personaTargets.find((pt) => pt.personaId === u.personaId)?.persona.name ?? "—";
                  return (
                    <tr key={u.externalId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs max-w-[100px] truncate">{u.externalId}</td>
                      <td className="px-4 py-2 max-w-[90px] truncate">{personaName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
