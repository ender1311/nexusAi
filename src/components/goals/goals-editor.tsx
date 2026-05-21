"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Goal, GoalTier } from "@/types/agent";
import { cn } from "@/lib/utils";
import { Trash2, CheckCircle2 } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";

const GOAL_TIERS: Array<{ value: GoalTier; label: string; color: string; weight: number }> = [
  { value: "best", label: "Best", color: "bg-green-500", weight: 10 },
  { value: "very_good", label: "Very Good", color: "bg-green-400", weight: 7 },
  { value: "good", label: "Good", color: "bg-blue-400", weight: 5 },
  { value: "bad", label: "Bad", color: "bg-yellow-500", weight: -2 },
  { value: "very_bad", label: "Very Bad", color: "bg-orange-500", weight: -5 },
  { value: "worst", label: "Worst", color: "bg-red-500", weight: -10 },
];

const TIER_COLORS: Record<string, string> = {
  best:      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  very_good: "bg-green-50 text-green-600 border-green-100 dark:bg-green-900/20 dark:text-green-500 dark:border-green-900",
  good:      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  bad:       "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
  very_bad:  "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  worst:     "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
};

type GoalDraft = Omit<Goal, "id" | "agentId"> & { id?: string };

const defaultNewGoal = (): GoalDraft => ({
  eventName: "",
  tier: "best",
  valueWeight: 10,
  weightMode: "fixed",
  weightProperty: null,
  weightDefault: 1.0,
});

type Props = {
  agentId: string;
  initialGoals: Goal[];
};

export function GoalsEditor({ agentId, initialGoals }: Props) {
  const [goals, setGoals] = useState<GoalDraft[]>(initialGoals);
  const [newGoal, setNewGoal] = useState<GoalDraft>(defaultNewGoal());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addGoal = () => {
    if (!newGoal.eventName.trim()) return;
    setGoals((g) => [...g, { ...newGoal }]);
    setNewGoal(defaultNewGoal());
  };

  const removeGoal = (index: number) => setGoals((g) => g.filter((_, i) => i !== index));

  const saveGoals = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/goals`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(goals.map((g) => ({
          eventName: g.eventName,
          tier: g.tier,
          valueWeight: g.valueWeight,
          weightMode: g.weightMode,
          weightProperty: g.weightProperty,
          weightDefault: g.weightDefault,
          description: g.description,
        }))),
      });
      if (res.ok) {
        const updated = await res.json() as Goal[];
        setGoals(updated);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            Add Conversion Goal
            <InfoTip title="Conversion Goals">
              <p>Goals define which user events count as a success or failure for this agent. When a tracked event fires, Nexus maps it to a <strong>reward value</strong> and uses that to update each variant&apos;s arm statistics.</p>
              <p className="mt-1">Over time, variants that produce more positive rewards receive a higher share of sends. Variants linked to negative events (unsubscribes, dismissals) are gradually deprioritized.</p>
              <p className="mt-1">You can have multiple goals — e.g. <code>plan_started</code> (Best) and <code>push_unsubscribed</code> (Worst) — to capture the full quality signal of each send.</p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-start">
            <Input
              placeholder="Event name (e.g. plan_started)"
              value={newGoal.eventName}
              onChange={(e) => setNewGoal((g) => ({ ...g, eventName: e.target.value }))}
              className="flex-1"
            />
            <div className="flex items-center gap-1">
            <Select value={newGoal.tier} onValueChange={(v) => {
              const t = v as GoalTier;
              setNewGoal((g) => ({ ...g, tier: t, valueWeight: GOAL_TIERS.find((x) => x.value === t)?.weight ?? 5 }));
            }}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_TIERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex items-center gap-2">
                      <div className={cn("h-2 w-2 rounded-full", t.color)} />
                      {t.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InfoTip title="Goal Tiers">
              <p>Tiers map your event to a reward magnitude. The bandit uses this reward to update each variant&apos;s arm statistics.</p>
              <p className="mt-1">
                <strong>Best</strong> (+10), <strong>Very Good</strong> (+7), <strong>Good</strong> (+5) — positive outcomes that strengthen the winning variant.<br />
                <strong>Bad</strong> (−2), <strong>Very Bad</strong> (−5), <strong>Worst</strong> (−10) — negative outcomes (unsubscribes, dismissals) that weaken the sending variant.
              </p>
              <p className="mt-1">Use negative tiers for undesirable events so the bandit actively avoids variants that cause them.</p>
            </InfoTip>
            </div>
          </div>

          {/* Weight mode toggle */}
          <div>
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              Weight Mode
              <InfoTip title="Weight Mode">
                <p><strong>Fixed Value</strong> — Every occurrence of this event contributes the same reward weight (e.g. +10 for every plan start).</p>
                <p className="mt-1"><strong>Event Property</strong> — The reward is drawn from a numeric property on the event itself (e.g. <code>order_value</code>). Ideal for revenue-weighted optimization where a $100 donation should count more than a $5 one.</p>
                <p className="mt-1">The Weight Default is used when the property is missing or zero, so the signal is never silently lost.</p>
              </InfoTip>
            </label>
            <div className="flex gap-2 mt-1.5">
              {(["fixed", "property"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setNewGoal((g) => ({ ...g, weightMode: mode }))}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-md border font-medium transition-colors",
                    newGoal.weightMode === mode
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-input text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "fixed" ? "Fixed Value" : "Event Property"}
                </button>
              ))}
            </div>
          </div>

          {newGoal.weightMode === "fixed" ? (
            <div>
              <label className="text-xs text-muted-foreground">Value weight: {newGoal.valueWeight}</label>
              <Slider
                min={-10} max={10} step={0.5}
                value={[newGoal.valueWeight]}
                onValueChange={(v) => setNewGoal((g) => ({ ...g, valueWeight: Array.isArray(v) ? v[0] : v }))}
                className="mt-1"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Property key (e.g. order_value)</label>
                <Input
                  placeholder="event property name"
                  value={newGoal.weightProperty ?? ""}
                  onChange={(e) => setNewGoal((g) => ({ ...g, weightProperty: e.target.value || null }))}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The numeric value of this event property will be used as the weight multiplier.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Default value (when property is missing): {newGoal.weightDefault}</label>
                <Slider
                  min={0.1} max={10} step={0.1}
                  value={[newGoal.weightDefault]}
                  onValueChange={(v) => setNewGoal((g) => ({ ...g, weightDefault: Array.isArray(v) ? v[0] : v }))}
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <Button size="sm" onClick={addGoal} disabled={!newGoal.eventName.trim()}>Add Goal</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Goals ({goals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No goals configured.</p>
          ) : (
            <div className="space-y-2">
              {goals.map((g, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={cn("h-3 w-3 rounded-full", GOAL_TIERS.find((t) => t.value === g.tier)?.color)} />
                    <div>
                      <p className="text-sm font-medium">{g.eventName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className={cn("text-xs capitalize", TIER_COLORS[g.tier] ?? "")}>
                          {g.tier.replace("_", " ")}
                        </Badge>
                        {g.weightMode === "property" ? (
                          <span className="text-xs text-muted-foreground">
                            property: <span className="font-mono">{g.weightProperty || "—"}</span>
                            {" "}(default: {g.weightDefault})
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">weight: {g.valueWeight}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeGoal(i)}
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={saveGoals} disabled={saving}>
          {saving ? "Saving…" : "Save Goals"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.history.back()}>Cancel</Button>
        {saved && (
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            Saved!
          </div>
        )}
      </div>
    </>
  );
}
