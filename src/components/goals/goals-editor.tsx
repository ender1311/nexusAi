"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Goal } from "@/types/agent";
import { cn } from "@/lib/utils";
import { Trash2, CheckCircle2 } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { GoalPresetPicker } from "@/components/agents/goal-preset-picker";
import { YouVersionGoalPreset, GoalColorGroup, goalColorGroup } from "@/lib/constants/youversion";
import { isInteractionFlag } from "@/lib/constants/interaction-flags";

const DOT_CLASSES: Record<GoalColorGroup, string> = {
  green: "bg-green-500",
  blue: "bg-blue-500",
  red: "bg-red-500",
};

const BADGE_CLASSES: Record<GoalColorGroup, string> = {
  green: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  blue: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  red: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
};

type GoalDraft = Omit<Goal, "id" | "agentId" | "conversionType"> & {
  id?: string;
  conversionType?: "first_interaction" | "any_interaction";
};

type Props = {
  agentId: string;
  initialGoals: Goal[];
};

export function GoalsEditor({ agentId, initialGoals }: Props) {
  const [goals, setGoals] = useState<GoalDraft[]>(
    initialGoals.map((g) => ({
      ...g,
      conversionType:
        isInteractionFlag(g.eventName) && !g.conversionType
          ? "first_interaction"
          : g.conversionType ?? undefined,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addPreset = (preset: YouVersionGoalPreset) => {
    setGoals((g) =>
      g.some((existing) => existing.eventName === preset.eventName)
        ? g
        : [
            ...g,
            {
              eventName: preset.eventName,
              tier: preset.tier,
              valueWeight: preset.weight,
              weightMode: "fixed",
              weightProperty: null,
              weightDefault: 1.0,
              description: preset.description,
              ...(isInteractionFlag(preset.eventName) ? { conversionType: "first_interaction" as const } : {}),
            },
          ],
    );
  };

  const setConversionType = (index: number, value: "first_interaction" | "any_interaction") => {
    setGoals((g) =>
      g.map((goal, i) => (i === index ? { ...goal, conversionType: value } : goal)),
    );
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
          ...(isInteractionFlag(g.eventName)
            ? { conversionType: g.conversionType ?? "first_interaction" }
            : {}),
        }))),
      });
      if (res.ok) {
        const updated = await res.json() as Goal[];
        setGoals(
          updated.map((g) => ({
            ...g,
            conversionType:
              isInteractionFlag(g.eventName) && !g.conversionType
                ? "first_interaction"
                : (g.conversionType ?? undefined),
          })),
        );
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
              <p className="mt-1">Pick from the YouVersion presets below — each carries a predefined reward tier and weight.</p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GoalPresetPicker onSelect={addPreset} selectedEventNames={goals.map((g) => g.eventName)} />
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
              {goals.map((g, i) => {
                const group = goalColorGroup({ eventName: g.eventName, weight: g.valueWeight });
                return (
                  <div key={i} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("h-3 w-3 rounded-full", DOT_CLASSES[group])} />
                        <div>
                          <p className="text-sm font-medium">{g.eventName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className={cn("text-xs capitalize", BADGE_CLASSES[group])}>
                              {g.tier.replace("_", " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">weight: {g.valueWeight}</span>
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
                    {isInteractionFlag(g.eventName) && (
                      <div className="mt-2 ml-6 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Conversion type</span>
                        <div className="flex rounded-md border overflow-hidden text-xs">
                          <button
                            type="button"
                            className={cn(
                              "px-2.5 py-1 font-medium transition-colors",
                              (g.conversionType ?? "first_interaction") === "first_interaction"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => setConversionType(i, "first_interaction")}
                          >
                            First interaction
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "px-2.5 py-1 font-medium transition-colors border-l",
                              (g.conversionType ?? "first_interaction") === "any_interaction"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => setConversionType(i, "any_interaction")}
                          >
                            Any interaction
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
