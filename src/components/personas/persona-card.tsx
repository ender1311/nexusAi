import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Persona } from "@/types/persona";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/mock/personas";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface PersonaCardProps {
  persona: Persona;
  totalUsers?: number;
}

function LtvDots({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className={cn("h-1.5 w-1.5 rounded-full", i < score ? "bg-primary" : "bg-muted")}
        />
      ))}
    </div>
  );
}

export function PersonaCard({ persona, totalUsers }: PersonaCardProps) {
  const colors = PERSONA_COLORS[persona.color] ?? PERSONA_COLORS.blue;
  const Icon = PERSONA_ICON_MAP[persona.icon];
  const isDiscovered = persona.source === "discovered";

  const userCount = persona.metrics?.userCount ?? persona._count?.trackedUsers ?? 0;
  const realCount = persona._count?.trackedUsers ?? 0;
  const pct = totalUsers && totalUsers > 0 ? (realCount / totalUsers) * 100 : null;

  return (
    <Link href={`/personas/${persona.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-4 flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", colors.iconBg)}>
              {Icon ? (
                <Icon className={cn("h-5 w-5", colors.text)} />
              ) : (
                <span className={cn("text-xs font-bold", colors.text)}>
                  {persona.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="font-semibold text-sm leading-tight truncate">{persona.name}</p>
                {isDiscovered && <Sparkles className="h-3 w-3 text-muted-foreground shrink-0" />}
              </div>
              {persona.label && (
                <p className={cn("text-xs font-medium", colors.text)}>{persona.label}</p>
              )}
            </div>
            <div className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", colors.dot)} />
          </div>

          {/* Badges */}
          {(persona.engagement || persona.contentModes || persona.channels || isDiscovered) && (
            <div className="flex flex-wrap gap-1">
              {persona.engagement && (
                <Badge variant="outline" className={cn("text-xs", colors.bg, colors.text, colors.border)}>
                  {persona.engagement.label}
                </Badge>
              )}
              {persona.contentModes?.slice(0, 2).map((m) => (
                <Badge key={m} variant="outline" className="text-xs capitalize">{m}</Badge>
              ))}
              {persona.channels?.slice(0, 2).map((c) => (
                <Badge key={c} variant="outline" className="text-xs capitalize">{c}</Badge>
              ))}
              {isDiscovered && persona.discoveredTraits?.dominantChannel && (
                <Badge variant="outline" className="text-xs capitalize">
                  {persona.discoveredTraits.dominantChannel}
                </Badge>
              )}
              {isDiscovered && persona.discoveredTraits?.engagementLevel && (
                <Badge variant="outline" className={cn("text-xs capitalize", colors.bg, colors.text, colors.border)}>
                  {persona.discoveredTraits.engagementLevel}
                </Badge>
              )}
            </div>
          )}

          {/* User count + audience % bar */}
          {(userCount > 0 || pct !== null) && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{formatNumber(realCount || userCount)}</span> users
                  {persona.metrics?.percentOfTotal && !totalUsers && ` · ${persona.metrics.percentOfTotal}% of total`}
                  {isDiscovered && persona.clusterSize > 0 && ` · cluster size: ${persona.clusterSize}`}
                </p>
                {pct !== null && (
                  <span className="text-xs font-semibold text-foreground">{pct.toFixed(1)}%</span>
                )}
              </div>
              {pct !== null && (
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", colors.dot.replace("bg-", "bg-"))}
                    style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Metrics or discovered traits */}
          {persona.metrics ? (
            <div className="grid grid-cols-3 gap-2 pt-1 border-t">
              <div>
                <p className="text-xs text-muted-foreground">Conv.</p>
                <p className="text-sm font-semibold">{persona.metrics.conversionRate}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Churn</p>
                <p className="text-sm font-semibold">{persona.metrics.churnRisk}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">LTV</p>
                <LtvDots score={persona.metrics.ltv} />
              </div>
            </div>
          ) : isDiscovered && persona.discoveredTraits ? (
            <div className="pt-1 border-t">
              {persona.discoveredTraits.conversionRate !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Est. conv.</p>
                  <p className="text-sm font-semibold">{(persona.discoveredTraits.conversionRate * 100).toFixed(1)}%</p>
                </div>
              )}
              {persona.silhouetteScore !== null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Silhouette: {persona.silhouetteScore?.toFixed(2)}
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
