"use client";

import { CheckCircle, Clock, MailOpen, Brain, Gift } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "@/components/ui/copyable-id";
import { buildPinnedProperties } from "@/lib/users/pinned-properties";
import type { TimelineEvent } from "@/lib/users/messaging-history";

export type ArmStat = {
  variantId: string;
  alpha: number;
  beta: number;
  tries: number;
  wins: number;
  expectedReward: number;
  variant: { id: string; name: string; title: string | null; body: string; message: { channel: string; agent: { id: string; name: string } } } | null;
};

export type UserDetailData = {
  user: {
    externalId: string;
    brazeId: string | null;
    personaId: string | null;
    personaName: string | null;
    personaConfidence: number | null;
    funnelStage: string | null;
    funnelStageUpdatedAt: string | null;
    timezone: string | null;
    preferredSendHour: number | null;
    preferredSendMinute: number | null;
    createdAt: string;
    totalDecisions: number;
    totalConversions: number;
    totalReward: number;
  };
  attributes: Record<string, unknown>;
  channelStats: Record<string, unknown>;
  messagingHistory: TimelineEvent[];
  armStats: ArmStat[];
  gifts: { count: number; totalUsd: number; mostRecent: { usd: number; agentName: string | null; timeToGiftHours: number; conversionAt: string } | null };
};

export function BetaBar({ alpha, beta }: { alpha: number; beta: number }) {
  const denom = alpha + beta;
  const pct = denom > 0 ? Math.round((alpha / denom) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function EventIcon({ type }: { type: TimelineEvent["type"] }) {
  if (type === "conversion") return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (type === "open") return <MailOpen className="h-3.5 w-3.5 text-blue-500" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />;
}

export function UserDetail({ data }: { data: UserDetailData }) {
  const { user } = data;
  const pinned = buildPinnedProperties({
    attributes: data.attributes,
    funnelStage: user.funnelStage,
    timezone: user.timezone,
    personaName: user.personaName,
  });
  const convRate = user.totalDecisions > 0 ? `${((user.totalConversions / user.totalDecisions) * 100).toFixed(0)}%` : "—";

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <CopyableId id={user.externalId} className="text-xs bg-muted px-2 py-0.5 rounded" />
              {user.personaName && <Badge variant="secondary" className="text-xs">{user.personaName}</Badge>}
              {user.personaConfidence !== null && (
                <span className="text-xs text-muted-foreground">{Math.round((user.personaConfidence ?? 0) * 100)}% confidence</span>
              )}
            </div>
            <div className="flex gap-4 text-center">
              {[
                { label: "Decisions", value: user.totalDecisions },
                { label: "Conversions", value: user.totalConversions },
                { label: "Conv. Rate", value: convRate },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-base font-bold">{value}</div>
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pinned properties */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Properties</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {pinned.map((p) => (
              <div key={p.label} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.label}</dt>
                <dd className="text-sm truncate">{p.value}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-4">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">All properties</summary>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {Object.entries(data.attributes).map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono text-muted-foreground align-top whitespace-nowrap">{k}</td>
                    <td className="py-1 break-all">{v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </CardContent>
      </Card>

      {/* Gifts */}
      {data.gifts.count > 0 && (
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Gift className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gifts via Nexus</p>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold">{data.gifts.count}</span>
            <span className="text-sm text-muted-foreground">${Math.round(data.gifts.totalUsd)} attributed</span>
          </div>
          {data.gifts.mostRecent && (
            <p className="text-xs text-muted-foreground mt-1">
              Most recent: ${Math.round(data.gifts.mostRecent.usd)}
              {data.gifts.mostRecent.agentName ? ` via ${data.gifts.mostRecent.agentName}` : ""}
              {` · ${data.gifts.mostRecent.timeToGiftHours.toFixed(1)}h to gift`}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Messaging history */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Messaging History (30d)</h3>
            </div>
            {data.messagingHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">No messages in the last 30 days</p>
            ) : (
              data.messagingHistory.map((e) => (
                <div key={e.id} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0"><EventIcon type={e.type} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium truncate">{e.variantName ?? "Unknown variant"}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">via {e.agentName ?? e.channel}</span>
                    </div>
                    {e.variantTitle && <p className="text-[10px] text-muted-foreground truncate">&ldquo;{e.variantTitle}&rdquo;</p>}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground capitalize">{e.type}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtTime(e.time)}</span>
                      {e.conversionEvent && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1 h-4 text-green-700 border-green-300">{e.conversionEvent}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Arm stats */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-1.5 mb-3">
              <Brain className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arm Stats — {user.personaName ?? "No persona"}</h3>
            </div>
            {data.armStats.length === 0 ? (
              <p className="text-xs text-muted-foreground">No arm stats yet</p>
            ) : (
              data.armStats.map((s) => (
                <div key={s.variantId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-medium truncate block">{s.variant?.name ?? s.variantId.slice(0, 8)}</span>
                      <span className="text-[10px] text-muted-foreground">{s.variant?.message.agent.name} · {s.tries} tries · {s.wins} wins</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono font-semibold">{(s.expectedReward * 100).toFixed(1)}%</div>
                      <div className="text-[10px] text-muted-foreground font-mono">α{s.alpha.toFixed(1)} β{s.beta.toFixed(1)}</div>
                    </div>
                  </div>
                  <BetaBar alpha={s.alpha} beta={s.beta} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
