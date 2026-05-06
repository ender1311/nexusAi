"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { ArmStatsResponse, ArmStatRow } from "@/app/api/demo/arm-stats/route";
import { betaPDFPoints } from "@/lib/engine/beta-pdf";

// ─── Signal Hierarchy data (sourced from reward-calculator.ts TIER_BASE_REWARDS) ─
const SIGNALS = [
  {
    event: "plan_completed / plan_read_day_7",
    tier: "best",
    rewardDisplay: "+10 → α",
    description: "User finished a reading plan or reached day 7",
    attribution: "30-day window",
    positive: true,
    strength: 100,
  },
  {
    event: "plan_started / plan_read_day_3",
    tier: "very_good",
    rewardDisplay: "+7 → α",
    description: "User started a plan or reached day 3",
    attribution: "30-day window",
    positive: true,
    strength: 70,
  },
  {
    event: "bible_opened / prayer_completed",
    tier: "good",
    rewardDisplay: "+5 → α",
    description: "User opened the app or completed a prayer",
    attribution: "48h window",
    positive: true,
    strength: 50,
  },
  {
    event: "no conversion (window expired)",
    tier: "neutral",
    rewardDisplay: "+1 → β",
    description: "No interaction within attribution window",
    attribution: "—",
    positive: false,
    strength: 20,
  },
  {
    event: "push_dismissed",
    tier: "bad",
    rewardDisplay: "+2 → β",
    description: "User explicitly swiped the notification away",
    attribution: "immediate",
    positive: false,
    strength: 40,
  },
  {
    event: "push_disabled (OS opt-out)",
    tier: "worst",
    rewardDisplay: "+10 → β across 90d",
    description: "User turned off push permissions — hard penalty on all recent arms",
    attribution: "90-day lookback",
    positive: false,
    strength: 100,
  },
] as const;

const CURVE_COLORS = ["#57a16c", "#8b5cf6", "#f97316", "#06b6d4", "#ec4899", "#eab308"];

// ─── Arm stats fetch hook ────────────────────────────────────────────────────
function useArmStats(agentId: string | null) {
  const [data, setData] = useState<ArmStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/demo/arm-stats?agentId=${agentId}`)
      .then((r) => r.json())
      .then((json: ArmStatsResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  return { data, loading };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function confidenceLabel(alpha: number, beta: number): string {
  const total = alpha + beta;
  if (total < 40) return "Exploring";
  if (total < 200) return "Learning";
  return "Converged";
}

function confidenceColor(label: string): string {
  return label === "Converged"
    ? "text-green-600"
    : label === "Learning"
    ? "text-yellow-600"
    : "text-blue-500";
}

function posteriorVariance(alpha: number, beta: number): number {
  const total = alpha + beta;
  return (alpha * beta) / (total * total * (total + 1));
}

type ArmStatus = "explore" | "promising" | "converged-good" | "converged-low";

function armStatus(row: ArmStatRow): ArmStatus {
  const mean = row.alpha / (row.alpha + row.beta);
  const total = row.alpha + row.beta;
  const variance = posteriorVariance(row.alpha, row.beta);
  if (variance > 0.005) return "explore";
  if (mean > 0.10 && total < 50) return "promising";
  if (mean < 0.05 && total >= 50) return "converged-low";
  return "converged-good";
}

const STATUS_CONFIG: Record<ArmStatus, { label: string; badge: string; description: string }> = {
  explore: {
    label: "🔬 Explore more",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    description: "High uncertainty — algorithm needs more data to assess this arm",
  },
  promising: {
    label: "🧪 Promising",
    badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    description: "High estimated rate but few sends — needs confirmation",
  },
  "converged-good": {
    label: "✅ Converged",
    badge: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    description: "Algorithm is confident — this is a reliable performer",
  },
  "converged-low": {
    label: "❌ Confirmed low",
    badge: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    description: "Narrow posterior around a low mean — consider retiring this variant",
  },
};

// ─── Tab 1: Signal Hierarchy ────────────────────────────────────────────────
function SignalHierarchyTab() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Every push outcome updates a Beta distribution. Positive signals increment{" "}
        <code className="bg-muted px-1 rounded text-xs">α</code> (successes); negative signals
        increment <code className="bg-muted px-1 rounded text-xs">β</code> (failures). The ratio{" "}
        <code className="bg-muted px-1 rounded text-xs">α / (α + β)</code> is the algorithm&apos;s
        current belief about a variant&apos;s conversion rate for a given persona.
      </p>

      <div className="rounded-lg border overflow-hidden text-xs">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Event</th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Attribution</th>
              <th className="text-left px-3 py-2 font-medium">Effect</th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {SIGNALS.map((s) => (
              <tr key={s.event} className="hover:bg-muted/20">
                <td className="px-3 py-2.5">
                  <div className="font-mono text-[11px] leading-tight">{s.event}</div>
                  <div className="text-muted-foreground text-[10px] mt-0.5">{s.description}</div>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {s.attribution}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 font-mono ${
                      s.positive
                        ? "border-green-400 text-green-700 dark:text-green-400"
                        : "border-red-300 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {s.rewardDisplay}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                      <div
                        className={`h-full rounded-full ${s.positive ? "bg-green-500" : "bg-red-400"}`}
                        style={{ width: `${s.strength}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-[10px] w-8">{s.strength}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-muted/40 border px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Normalisation:</strong> Raw tier scores (±2 to ±10) are
        divided by 10 before updating Beta parameters, keeping all updates in the [−1, 1] range.
        This is Bayesian online learning: the algorithm never forgets, but temporal decay (×0.99 per
        update) gradually reduces the weight of old evidence.
      </div>
    </div>
  );
}

// ─── Tab 2: Beta Curves ──────────────────────────────────────────────────────
function PriorCurveChart() {
  const pts = betaPDFPoints(1, 30);
  const chartData = pts.map((p) => ({ x: Math.round(p.x * 100), y: Math.round(p.y * 100) / 100 }));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="x" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10 }} />
        <YAxis hide />
        <Area
          type="monotone"
          dataKey="y"
          stroke="#94a3b8"
          fill="#94a3b8"
          fillOpacity={0.2}
          strokeWidth={2}
          isAnimationActive
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PriorExplainer() {
  return (
    <div className="rounded-lg bg-muted/40 border px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
      <strong className="text-foreground">Beta(1, 30) pessimistic prior:</strong> New variants
      start with an expected conversion rate of ~3.2% (matching real-world push CTR). The wide,
      left-skewed shape means the algorithm is very uncertain — it will explore all variants
      broadly before committing to a winner.
    </div>
  );
}

function BetaCurvesTab({ data, loading }: { data: ArmStatsResponse | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm animate-pulse">
        Loading arm stats…
      </div>
    );
  }

  if (!data || data.armStats.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No arm data yet — this agent hasn&apos;t run any sends. Below is the{" "}
          <strong>pessimistic prior</strong> every new variant starts with.
        </p>
        <PriorCurveChart />
        <PriorExplainer />
      </div>
    );
  }

  // Group by variantId; within each variant show all personas as separate curves
  const variantIds = [...new Set(data.armStats.map((s) => s.variantId))];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Each curve is the algorithm&apos;s current belief about a variant&apos;s conversion rate
        for one persona. A <strong>wide curve</strong> means high uncertainty (still exploring). A{" "}
        <strong>narrow spike</strong> means the algorithm has converged — it knows what this variant
        does for this persona.
      </p>

      {variantIds.map((variantId, vi) => {
        const rows = data.armStats.filter((s) => s.variantId === variantId);
        const variantName = rows[0]?.variantName ?? variantId;

        // Build chart data: 50 x-points, one y column per persona
        const chartData = betaPDFPoints(1, 1).map((_, i) => {
          const x = 0.01 + (0.98 * i) / 49;
          const point: Record<string, number> = { x: Math.round(x * 100) };
          rows.forEach((row) => {
            const pts = betaPDFPoints(row.alpha, row.beta);
            point[row.personaName] = Math.round((pts[i]?.y ?? 0) * 100) / 100;
          });
          return point;
        });

        return (
          <div key={variantId} className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">{variantName}</span>
              <span className="text-xs text-muted-foreground">{rows.length} persona(s)</span>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap gap-3 mb-3">
              {rows.map((row) => {
                const mean = row.alpha / (row.alpha + row.beta);
                const label = confidenceLabel(row.alpha, row.beta);
                return (
                  <div key={row.personaId} className="text-[11px] text-muted-foreground">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1"
                      style={{ background: CURVE_COLORS[vi % CURVE_COLORS.length] }}
                    />
                    {row.personaName} — E[θ]={" "}
                    <strong>{(mean * 100).toFixed(1)}%</strong> ·{" "}
                    <span className={confidenceColor(label)}>{label}</span>
                  </div>
                );
              })}
            </div>

            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 10 }}
                  label={{ value: "Conversion rate", position: "insideBottom", offset: -2, fontSize: 10 }}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(v: unknown, name: string | number | undefined) => [`${(v as number).toFixed(2)}`, String(name ?? "")]}
                  labelFormatter={(v: unknown) => `${v as number}% CTR`}
                />
                {rows.map((row, ri) => (
                  <Area
                    key={row.personaId}
                    type="monotone"
                    dataKey={row.personaName}
                    stroke={CURVE_COLORS[(vi + ri) % CURVE_COLORS.length]}
                    fill={CURVE_COLORS[(vi + ri) % CURVE_COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={800}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 3: What to Test Next ─────────────────────────────────────────────────
function WhatToTestTab({ data, loading }: { data: ArmStatsResponse | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm animate-pulse">
        Loading arm stats…
      </div>
    );
  }

  if (!data || data.armStats.length === 0) {
    return (
      <div className="rounded-lg bg-muted/40 border px-4 py-6 text-center text-sm text-muted-foreground">
        No arm data yet. Run some sends to see exploration guidance.
      </div>
    );
  }

  // Rank by posterior variance descending (highest uncertainty = test first)
  const ranked = [...data.armStats].sort(
    (a, b) => posteriorVariance(b.alpha, b.beta) - posteriorVariance(a.alpha, a.beta)
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Thompson Sampling self-regulates exploration — arms with <strong>wide Beta
        distributions</strong> (high posterior variance) naturally receive more sends because
        they occasionally sample very high values. This table shows which arms need the most
        attention right now.
      </p>

      <div className="rounded-lg border overflow-hidden text-xs">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Variant</th>
              <th className="text-left px-3 py-2 font-medium">Persona</th>
              <th className="text-right px-3 py-2 font-medium">E[θ]</th>
              <th className="text-right px-3 py-2 font-medium">Sends</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ranked.map((row) => {
              const mean = row.alpha / (row.alpha + row.beta);
              const total = row.alpha + row.beta;
              const status = armStatus(row);
              const config = STATUS_CONFIG[status];
              return (
                <tr key={`${row.variantId}-${row.personaId}`} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{row.variantName}</div>
                    <div className="text-muted-foreground text-[10px] font-mono truncate max-w-[120px]">
                      {row.variantBody.slice(0, 40)}…
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{ background: `${row.personaColor}22`, color: row.personaColor }}
                    >
                      {row.personaIcon} {row.personaName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {(mean * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                    {Math.round(total)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${config.badge}`}
                      title={config.description}
                    >
                      {config.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-muted/40 border px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
        <strong className="text-foreground">How Thompson Sampling decides what to test:</strong>{" "}
        Arms with high posterior variance occasionally sample very high values, causing the algorithm
        to select them — even if their current mean is not the highest. This is the exploration
        mechanism. No manual epsilon needed; uncertainty itself drives exploration.
      </div>
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────
export function RewardIntelligencePanel() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get("agent");
  const [activeTab, setActiveTab] = useState("signals");
  const { data: armData, loading: armLoading } = useArmStats(agentId);

  if (!agentId) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
          Select an agent above to see how it learns.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold">How the Algorithm Learns</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live reward mechanics for the selected agent
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="signals">Signal Hierarchy</TabsTrigger>
            <TabsTrigger value="curves">Beta Curves</TabsTrigger>
            <TabsTrigger value="next">What to Test Next</TabsTrigger>
          </TabsList>

          <TabsContent value="signals">
            <SignalHierarchyTab />
          </TabsContent>

          <TabsContent value="curves">
            <BetaCurvesTab data={armData} loading={armLoading} />
          </TabsContent>

          <TabsContent value="next">
            <WhatToTestTab data={armData} loading={armLoading} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
