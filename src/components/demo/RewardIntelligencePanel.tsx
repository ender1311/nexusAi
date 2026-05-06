"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

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

// ─── Skeleton placeholder for tabs not yet implemented ──────────────────────
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
      {label} — loading…
    </div>
  );
}

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

// ─── Main panel ─────────────────────────────────────────────────────────────
export function RewardIntelligencePanel() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get("agent");
  const [activeTab, setActiveTab] = useState("signals");

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
            <ComingSoon label="Beta Curves" />
          </TabsContent>

          <TabsContent value="next">
            <ComingSoon label="What to Test Next" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
