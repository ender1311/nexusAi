import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/mock/personas";
import { Persona } from "@/types/persona";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Users2, TrendingUp, AlertTriangle, Star, User,
  Activity, Sparkles, MessageSquare, Bell, Mail, Smartphone,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import type { TimingHeatmapCell } from "@/types/metrics";

async function getPersona(id: string): Promise<Persona | null> {
  try {
    const row = await prisma.persona.findUnique({
      where: { id },
      include: { _count: { select: { trackedUsers: true } } },
    });
    return row as unknown as Persona | null;
  } catch {
    return null;
  }
}

// Deterministic pseudo-random from a string seed + index
function dv(seed: string, index: number, min: number, max: number): number {
  let hash = 0;
  const str = seed + String(index);
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash ^ str.charCodeAt(i), 0x9e3779b9);
    hash ^= hash >>> 15;
  }
  const t = (Math.abs(hash) % 10000) / 10000;
  return +(min + t * (max - min)).toFixed(2);
}

function buildHeatmap(personaId: string, engagementLevel: string): TimingHeatmapCell[] {
  const cells: TimingHeatmapCell[] = [];
  const isDormant = engagementLevel === "dormant";
  const isWeekend = engagementLevel === "weekly";

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const base = dv(personaId, day * 100 + hour, 0, 10);
      // Boost morning (5-9am) and evening (7-10pm) hours
      const morningBoost = hour >= 5 && hour <= 9 ? 3 : 0;
      const eveningBoost = hour >= 19 && hour <= 22 ? 2 : 0;
      // Weekend-heavy personas
      const weekendBoost = isWeekend && (day === 0 || day === 6) ? 4 : 0;
      const weekdayPenalty = isWeekend && day >= 1 && day <= 5 ? -3 : 0;
      const dormantPenalty = isDormant ? -5 : 0;
      const raw = base + morningBoost + eveningBoost + weekendBoost + weekdayPenalty + dormantPenalty;
      cells.push({ day, hour, value: Math.max(0, Math.min(10, raw)) });
    }
  }
  return cells;
}

interface RecentCampaign {
  name: string;
  channel: "push" | "email" | "in-app";
  sends: number;
  openRate: number;
  convRate: number;
  trend: "up" | "down" | "flat";
}

function buildCampaigns(personaId: string, channels: string[]): RecentCampaign[] {
  const templates = [
    { name: "Daily Verse Reminder", channel: "push" as const },
    { name: "Weekly Reading Plan Nudge", channel: "email" as const },
    { name: "Streak Milestone Celebration", channel: "in-app" as const },
    { name: "New Plan Recommendation", channel: "push" as const },
    { name: "Re-engagement Prompt", channel: "email" as const },
  ];
  const trends: ("up" | "down" | "flat")[] = ["up", "flat", "up", "down", "up"];

  return templates
    .filter((t) => channels.includes(t.channel) || channels.length === 0)
    .slice(0, 4)
    .map((t, i) => ({
      name: t.name,
      channel: t.channel,
      sends: Math.round(dv(personaId, i + 200, 2000, 18000)),
      openRate: +dv(personaId, i + 300, 4, 38).toFixed(1),
      convRate: +dv(personaId, i + 400, 1.5, 12).toFixed(1),
      trend: trends[i],
    }));
}

interface ChannelStat {
  channel: "push" | "email" | "in-app";
  label: string;
  icon: typeof Bell;
  sends: number;
  openRate: number;
  convRate: number;
}

function buildChannelStats(personaId: string, channels: string[]): ChannelStat[] {
  const allChannels: ChannelStat[] = [
    { channel: "push", label: "Push", icon: Bell, sends: Math.round(dv(personaId, 500, 8000, 24000)), openRate: +dv(personaId, 501, 5, 18).toFixed(1), convRate: +dv(personaId, 502, 2, 10).toFixed(1) },
    { channel: "email", label: "Email", icon: Mail, sends: Math.round(dv(personaId, 510, 2000, 8000)), openRate: +dv(personaId, 511, 14, 38).toFixed(1), convRate: +dv(personaId, 512, 3, 14).toFixed(1) },
    { channel: "in-app", label: "In-App", icon: Smartphone, sends: Math.round(dv(personaId, 520, 1000, 5000)), openRate: +dv(personaId, 521, 22, 52).toFixed(1), convRate: +dv(personaId, 522, 5, 18).toFixed(1) },
  ];
  return allChannels.filter((c) => channels.includes(c.channel));
}

const CHANNEL_ICON_MAP = { push: Bell, email: Mail, "in-app": Smartphone };
const CHANNEL_COLOR = { push: "text-blue-600", email: "text-violet-600", "in-app": "text-emerald-600" };

export default async function PersonaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = await getPersona(id);
  if (!persona) notFound();

  const colors = PERSONA_COLORS[persona.color] ?? PERSONA_COLORS.blue;
  const Icon = PERSONA_ICON_MAP[persona.icon];
  const isDiscovered = persona.source === "discovered";

  const userCount = persona.metrics?.userCount ?? persona._count?.trackedUsers ?? 0;
  const channels = persona.channels ?? ["push", "email"];
  const engagementLevel = persona.engagement?.level ?? "moderate";

  const heatmapData = buildHeatmap(persona.id, engagementLevel);
  const campaigns = buildCampaigns(persona.id, channels);
  const channelStats = buildChannelStats(persona.id, channels);
  const maxConv = Math.max(...channelStats.map((c) => c.convRate), 1);

  return (
    <>
      <Header title={persona.name} description={persona.description ?? undefined} />
      <div className="p-6 space-y-4">
        {/* Identity header */}
        <div className="flex items-center gap-4">
          <div className={cn("h-16 w-16 rounded-2xl flex items-center justify-center shrink-0", colors.iconBg)}>
            {Icon ? (
              <Icon className={cn("h-8 w-8", colors.text)} />
            ) : (
              <span className={cn("text-lg font-bold", colors.text)}>
                {persona.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold">{persona.name}</h2>
              {persona.label && (
                <span className={cn("text-sm font-medium px-2 py-0.5 rounded-full border", colors.bg, colors.text, colors.border)}>
                  {persona.label}
                </span>
              )}
              {isDiscovered ? (
                <Badge variant="outline" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" /> Discovered
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">Manual</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {persona.demographics && (
                <>
                  <Badge variant="outline" className="text-xs">Age {persona.demographics.ageRange}</Badge>
                  <Badge variant="outline" className="text-xs">
                    {persona.demographics.gender === "F" ? "Female" : persona.demographics.gender === "M" ? "Male" : "Mixed"}
                  </Badge>
                </>
              )}
              {persona.engagement && (
                <Badge variant="outline" className={cn("text-xs", colors.bg, colors.text, colors.border)}>
                  {persona.engagement.label}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Users2 className="h-3.5 w-3.5" /> Users</p>
              <p className="text-xl font-bold mt-1">{formatNumber(userCount)}</p>
              {persona.metrics?.percentOfTotal && (
                <p className="text-xs text-muted-foreground">{persona.metrics.percentOfTotal}% of total</p>
              )}
            </CardContent>
          </Card>
          {persona.metrics ? (
            <>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3.5 w-3.5" /> Sessions/wk</p>
                  <p className="text-xl font-bold mt-1">{persona.metrics.avgSessionsPerWeek.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">{persona.metrics.avgSessionMinutes} min avg</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Conv. Rate</p>
                  <p className="text-xl font-bold mt-1 text-primary">{persona.metrics.conversionRate}%</p>
                  <p className="text-xs text-muted-foreground">{persona.metrics.streakDays}d avg streak</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3.5 w-3.5" /> LTV Score</p>
                  <p className="text-xl font-bold mt-1">{persona.metrics.ltv}/10</p>
                  <p className="text-xs flex items-center gap-1">
                    <AlertTriangle className={cn("h-3 w-3", persona.metrics.churnRisk > 50 ? "text-red-500" : persona.metrics.churnRisk > 25 ? "text-yellow-500" : "text-green-500")} />
                    <span className={persona.metrics.churnRisk > 50 ? "text-red-600" : persona.metrics.churnRisk > 25 ? "text-yellow-600" : "text-green-600"}>
                      {persona.metrics.churnRisk}% churn risk
                    </span>
                  </p>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile"><User className="h-3.5 w-3.5 mr-1.5" />Profile</TabsTrigger>
            <TabsTrigger value="behavior"><Activity className="h-3.5 w-3.5 mr-1.5" />Behavior</TabsTrigger>
            <TabsTrigger value="messaging"><MessageSquare className="h-3.5 w-3.5 mr-1.5" />Messaging</TabsTrigger>
            {isDiscovered && (
              <TabsTrigger value="discovery"><Sparkles className="h-3.5 w-3.5 mr-1.5" />Discovery</TabsTrigger>
            )}
          </TabsList>

          {/* Profile tab */}
          <TabsContent value="profile" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {persona.lifeContext && (
                <Card>
                  <CardHeader><CardTitle className="text-sm font-semibold">Life Context</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{persona.lifeContext}</p>
                  </CardContent>
                </Card>
              )}

              {(persona.contentModes || persona.channels) && (
                <Card>
                  <CardHeader><CardTitle className="text-sm font-semibold">Content & Channels</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {persona.contentModes && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">Content Modes</p>
                        <div className="flex flex-wrap gap-1">
                          {persona.contentModes.map((m) => (
                            <Badge key={m} variant="outline" className="text-xs capitalize">{m}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {persona.channels && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">Preferred Channels</p>
                        <div className="flex flex-wrap gap-1">
                          {persona.channels.map((c) => (
                            <Badge key={c} variant="outline" className="text-xs capitalize">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {persona.features && persona.features.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm font-semibold">Features Used</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {persona.features.map((f) => (
                        <span key={f} className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", colors.bg, colors.text, colors.border)}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {persona.tags && persona.tags.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm font-semibold">Tags</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {persona.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Behavior tab */}
          <TabsContent value="behavior" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {persona.metrics && (
                <Card>
                  <CardHeader><CardTitle className="text-sm font-semibold">Engagement Pattern</CardTitle></CardHeader>
                  <CardContent className="space-y-0">
                    {persona.engagement && (
                      <div className="flex justify-between py-2.5 border-b">
                        <span className="text-sm text-muted-foreground">Engagement Level</span>
                        <span className="text-sm font-medium capitalize">{persona.engagement.level}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-2.5 border-b">
                      <span className="text-sm text-muted-foreground">Sessions / Week</span>
                      <span className="text-sm font-medium">{persona.metrics.avgSessionsPerWeek.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between py-2.5 border-b">
                      <span className="text-sm text-muted-foreground">Avg Session Length</span>
                      <span className="text-sm font-medium">{persona.metrics.avgSessionMinutes} min</span>
                    </div>
                    <div className="flex justify-between py-2.5 border-b">
                      <span className="text-sm text-muted-foreground">Avg Streak</span>
                      <span className="text-sm font-medium">{persona.metrics.streakDays} days</span>
                    </div>
                    <div className="flex justify-between py-2.5">
                      <span className="text-sm text-muted-foreground">Churn Risk</span>
                      <span className={cn("text-sm font-semibold", persona.metrics.churnRisk > 50 ? "text-red-600" : persona.metrics.churnRisk > 25 ? "text-yellow-600" : "text-green-600")}>
                        {persona.metrics.churnRisk}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {persona.contentModes && persona.contentModes.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm font-semibold">Content Mode Distribution</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {persona.contentModes.map((mode, i) => {
                      const barPct = 100 - i * (60 / Math.max(persona.contentModes!.length - 1, 1));
                      return (
                        <div key={mode} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="capitalize font-medium">{mode}</span>
                            <span className="text-muted-foreground">{Math.round(barPct)}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full", colors.dot)} style={{ width: `${barPct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Timing heatmap */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Engagement Timing Heatmap</CardTitle></CardHeader>
              <CardContent>
                <TimingHeatmap data={heatmapData} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Messaging tab */}
          <TabsContent value="messaging" className="mt-4 space-y-4">
            {/* Channel performance */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Channel Performance</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {channelStats.map((ch) => {
                  const CIcon = CHANNEL_ICON_MAP[ch.channel];
                  const barWidth = (ch.convRate / maxConv) * 100;
                  return (
                    <div key={ch.channel} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CIcon className={cn("h-4 w-4", CHANNEL_COLOR[ch.channel])} />
                          <span className="text-sm font-medium">{ch.label}</span>
                          <span className="text-xs text-muted-foreground">{formatNumber(ch.sends)} sends</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{ch.openRate}% open</span>
                          <span className="font-semibold text-foreground">{ch.convRate}% conv</span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", colors.dot)}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Recent campaigns */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Recent Campaigns</CardTitle></CardHeader>
              <CardContent>
                <div className="divide-y">
                  {campaigns.map((c, i) => {
                    const CIcon = CHANNEL_ICON_MAP[c.channel] ?? Bell;
                    return (
                      <div key={i} className="flex items-center justify-between py-3 gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <CIcon className={cn("h-4 w-4 shrink-0", CHANNEL_COLOR[c.channel])} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{c.channel} · {formatNumber(c.sends)} sends</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 text-xs">
                          <div className="text-right">
                            <p className="text-muted-foreground">Open</p>
                            <p className="font-medium">{c.openRate}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Conv</p>
                            <p className={cn("font-semibold", c.trend === "up" ? "text-emerald-600" : c.trend === "down" ? "text-red-500" : "text-foreground")}>
                              {c.convRate}%
                              {c.trend === "up" ? " ↑" : c.trend === "down" ? " ↓" : ""}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Discovery tab (discovered personas only) */}
          {isDiscovered && (
            <TabsContent value="discovery" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4" /> Discovered Behavioral Traits
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-0">
                  {persona.discoveredTraits && (
                    <>
                      <div className="flex justify-between py-2.5 border-b">
                        <span className="text-sm text-muted-foreground">Dominant Channel</span>
                        <span className="text-sm font-medium capitalize">{persona.discoveredTraits.dominantChannel ?? "—"}</span>
                      </div>
                      <div className="flex justify-between py-2.5 border-b">
                        <span className="text-sm text-muted-foreground">Peak Hour (UTC)</span>
                        <span className="text-sm font-medium">
                          {persona.discoveredTraits.peakHour !== undefined ? `${persona.discoveredTraits.peakHour}:00` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between py-2.5 border-b">
                        <span className="text-sm text-muted-foreground">Engagement Level</span>
                        <span className="text-sm font-medium capitalize">{persona.discoveredTraits.engagementLevel ?? "—"}</span>
                      </div>
                      <div className="flex justify-between py-2.5 border-b">
                        <span className="text-sm text-muted-foreground">Est. Conv. Rate</span>
                        <span className="text-sm font-medium">
                          {persona.discoveredTraits.conversionRate !== undefined
                            ? `${(persona.discoveredTraits.conversionRate * 100).toFixed(1)}%`
                            : "—"}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between py-2.5 border-b">
                    <span className="text-sm text-muted-foreground">Cluster Size</span>
                    <span className="text-sm font-medium">{persona.clusterSize} users</span>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <span className="text-sm text-muted-foreground">Silhouette Score</span>
                    <span className="text-sm font-medium">
                      {persona.silhouetteScore !== null ? persona.silhouetteScore?.toFixed(4) : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}
