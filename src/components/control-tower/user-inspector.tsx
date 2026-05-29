"use client";

import { useState } from "react";
import { Search, User, CheckCircle, XCircle, Clock, Brain } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "@/components/ui/copyable-id";
import { cn } from "@/lib/utils";

interface ArmStat {
  variantId: string;
  agentId: string;
  alpha: number;
  beta: number;
  tries: number;
  wins: number;
  expectedReward: number;
  variant: {
    id: string;
    name: string;
    title: string | null;
    body: string;
    message: { channel: string; agent: { id: string; name: string } };
  } | null;
}

interface Decision {
  id: string;
  sentAt: string;
  channel: string;
  reward: number | null;
  conversionEvent: string | null;
  variant: {
    id: string;
    name: string;
    title: string | null;
    body: string;
    message: { channel: string; agent: { id: string; name: string } };
  } | null;
}

interface UserData {
  user: {
    externalId: string;
    personaId: string | null;
    personaName: string | null;
    personaConfidence: number | null;
    totalDecisions: number;
    totalConversions: number;
    totalReward: number;
  };
  recentDecisions: Decision[];
  armStats: ArmStat[];
}

export function BetaBar({ alpha, beta }: { alpha: number; beta: number }) {
  // A fresh arm has alpha === beta === 0; 0/0 would render NaN%.
  const denom = alpha + beta;
  const pct = denom > 0 ? Math.round((alpha / denom) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

export function UserInspector() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup(id: string) {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id.trim())}`);
      if (res.status === 404) { setError("User not found"); return; }
      if (!res.ok) { setError("Failed to fetch user"); return; }
      const body = await res.json() as { data: UserData };
      setResult(body.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">User Inspector</h2>
        </div>
        <span className="text-xs text-muted-foreground">Live decisions + arm stats per user</span>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup(query)}
            placeholder="Enter user external ID…"
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={() => lookup(query)}
          disabled={loading || !query.trim()}
          className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? "…" : "Inspect"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {result && (
        <div className="space-y-4">
          {/* User summary */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CopyableId
                      id={result.user.externalId}
                      className="text-xs bg-muted px-2 py-0.5 rounded"
                    />
                    {result.user.personaName && (
                      <Badge variant="secondary" className="text-xs">
                        {result.user.personaName}
                      </Badge>
                    )}
                    {result.user.personaConfidence !== null && (
                      <span className="text-xs text-muted-foreground">
                        {Math.round((result.user.personaConfidence ?? 0) * 100)}% confidence
                      </span>
                    )}
                  </div>
                  {!result.user.personaId && (
                    <p className="text-xs text-amber-600">No persona assigned yet</p>
                  )}
                </div>
                <div className="flex gap-4 text-center">
                  {[
                    { label: "Decisions", value: result.user.totalDecisions },
                    { label: "Conversions", value: result.user.totalConversions },
                    {
                      label: "Conv. Rate",
                      value: result.user.totalDecisions > 0
                        ? `${((result.user.totalConversions / result.user.totalDecisions) * 100).toFixed(0)}%`
                        : "—",
                    },
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent decisions */}
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent Decisions
                  </h3>
                </div>
                {result.recentDecisions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No decisions yet</p>
                ) : (
                  result.recentDecisions.map((d) => {
                    const converted = d.conversionEvent !== null;
                    const neutral = d.reward === null;
                    return (
                      <div key={d.id} className="flex items-start gap-2.5">
                        <div className="mt-0.5 shrink-0">
                          {converted ? (
                            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          ) : neutral ? (
                            <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-red-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-medium truncate">
                              {d.variant?.name ?? "Unknown variant"}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              via {d.variant?.message.agent.name ?? d.channel}
                            </span>
                          </div>
                          {d.variant?.title && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              &ldquo;{d.variant.title}&rdquo;
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(d.sentAt).toLocaleString(undefined, {
                                month: "short", day: "numeric",
                                hour: "numeric", minute: "2-digit",
                              })}
                            </span>
                            {d.conversionEvent && (
                              <Badge variant="outline" className="text-[9px] py-0 px-1 h-4 text-green-700 border-green-300">
                                {d.conversionEvent}
                              </Badge>
                            )}
                            {d.reward !== null && (
                              <span className={cn(
                                "text-[10px] font-mono font-medium",
                                d.reward > 0 ? "text-green-600" : "text-red-500"
                              )}>
                                {d.reward > 0 ? "+" : ""}{d.reward.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Arm stats */}
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <Brain className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Arm Stats — {result.user.personaName ?? "No persona"}
                  </h3>
                </div>
                {result.armStats.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No arm stats yet — will populate after first decision
                  </p>
                ) : (
                  result.armStats.map((s) => (
                    <div key={s.variantId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-medium truncate block">
                            {s.variant?.name ?? s.variantId.slice(0, 8)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.variant?.message.agent.name} · {s.tries} tries · {s.wins} wins
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-mono font-semibold">
                            {(s.expectedReward * 100).toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            α{s.alpha.toFixed(1)} β{s.beta.toFixed(1)}
                          </div>
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
      )}
    </div>
  );
}
