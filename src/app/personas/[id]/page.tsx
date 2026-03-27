import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/mock/personas";
import { Persona } from "@/types/persona";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Users2, TrendingUp, AlertTriangle, Star, User, Activity, Sparkles } from "lucide-react";

async function getPersona(id: string): Promise<Persona | null> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/personas/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function PersonaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = await getPersona(id);
  if (!persona) notFound();

  const colors = PERSONA_COLORS[persona.color] ?? PERSONA_COLORS.blue;
  const Icon = PERSONA_ICON_MAP[persona.icon];
  const isDiscovered = persona.source === "discovered";

  const userCount = persona.metrics?.userCount ?? persona._count?.users ?? 0;

  return (
    <>
      <Header title={persona.name} description={persona.description ?? undefined} />
      <div className="p-6 space-y-4">
        {/* Identity header */}
        <div className="flex items-center gap-4">
          <div className={cn("h-16 w-16 rounded-2xl flex items-center justify-center", colors.iconBg)}>
            {Icon ? (
              <Icon className={cn("h-8 w-8", colors.text)} />
            ) : (
              <span className={cn("text-lg font-bold", colors.text)}>
                {persona.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{persona.name}</h2>
              {persona.label && (
                <span className={cn("text-sm font-medium px-2 py-0.5 rounded-full border", colors.bg, colors.text, colors.border)}>
                  {persona.label}
                </span>
              )}
              {isDiscovered ? (
                <Badge variant="outline" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" />
                  Discovered
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">Manual</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
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
              {isDiscovered && persona.discoveredTraits?.engagementLevel && (
                <Badge variant="outline" className={cn("text-xs capitalize", colors.bg, colors.text, colors.border)}>
                  {persona.discoveredTraits.engagementLevel}
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
              {isDiscovered && (
                <p className="text-xs text-muted-foreground">cluster size: {persona.clusterSize}</p>
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
          ) : isDiscovered ? (
            <>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Est. Conv.</p>
                  <p className="text-xl font-bold mt-1 text-primary">
                    {persona.discoveredTraits?.conversionRate !== undefined
                      ? `${(persona.discoveredTraits.conversionRate * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Silhouette</p>
                  <p className="text-xl font-bold mt-1">
                    {persona.silhouetteScore !== null ? persona.silhouetteScore?.toFixed(3) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">cluster quality</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Dominant Channel</p>
                  <p className="text-xl font-bold mt-1 capitalize">{persona.discoveredTraits?.dominantChannel ?? "—"}</p>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">
              <User className="h-3.5 w-3.5 mr-1.5" />
              Profile
            </TabsTrigger>
            {persona.metrics && (
              <TabsTrigger value="behavior">
                <Activity className="h-3.5 w-3.5 mr-1.5" />
                Behavior
              </TabsTrigger>
            )}
            {isDiscovered && (
              <TabsTrigger value="discovery">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Discovery
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="profile" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {persona.lifeContext && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Life Context</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{persona.lifeContext}</p>
                  </CardContent>
                </Card>
              )}

              {(persona.contentModes || persona.channels) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Content & Channels</CardTitle>
                  </CardHeader>
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
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Features Used</CardTitle>
                  </CardHeader>
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
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Tags</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {persona.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {persona.description && !persona.lifeContext && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Description</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{persona.description}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {persona.metrics && (
            <TabsContent value="behavior" className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold">Engagement Pattern</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {persona.engagement && (
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Engagement Level</span>
                        <span className="text-sm font-medium capitalize">{persona.engagement.level}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Sessions / Week</span>
                      <span className="text-sm font-medium">{persona.metrics.avgSessionsPerWeek.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Avg Session Length</span>
                      <span className="text-sm font-medium">{persona.metrics.avgSessionMinutes} min</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Avg Streak</span>
                      <span className="text-sm font-medium">{persona.metrics.streakDays} days</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-sm text-muted-foreground">Churn Risk</span>
                      <span className={cn("text-sm font-semibold", persona.metrics.churnRisk > 50 ? "text-red-600" : persona.metrics.churnRisk > 25 ? "text-yellow-600" : "text-green-600")}>
                        {persona.metrics.churnRisk}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {persona.contentModes && persona.contentModes.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-semibold">Content Mode Distribution</CardTitle>
                    </CardHeader>
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
            </TabsContent>
          )}

          {isDiscovered && (
            <TabsContent value="discovery" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4" />
                    Discovered Behavioral Traits
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {persona.discoveredTraits && (
                    <>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Dominant Channel</span>
                        <span className="text-sm font-medium capitalize">{persona.discoveredTraits.dominantChannel ?? "—"}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Peak Hour (UTC)</span>
                        <span className="text-sm font-medium">
                          {persona.discoveredTraits.peakHour !== undefined ? `${persona.discoveredTraits.peakHour}:00` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Engagement Level</span>
                        <span className="text-sm font-medium capitalize">{persona.discoveredTraits.engagementLevel ?? "—"}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">Est. Conv. Rate</span>
                        <span className="text-sm font-medium">
                          {persona.discoveredTraits.conversionRate !== undefined
                            ? `${(persona.discoveredTraits.conversionRate * 100).toFixed(1)}%`
                            : "—"}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Cluster Size</span>
                    <span className="text-sm font-medium">{persona.clusterSize} users</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Silhouette Score</span>
                    <span className="text-sm font-medium">
                      {persona.silhouetteScore !== null ? persona.silhouetteScore?.toFixed(4) : "—"}
                    </span>
                  </div>
                  {persona.discoveredAt && (
                    <div className="flex justify-between py-2">
                      <span className="text-sm text-muted-foreground">Last Discovered</span>
                      <span className="text-sm font-medium">
                        {new Date(persona.discoveredAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}
