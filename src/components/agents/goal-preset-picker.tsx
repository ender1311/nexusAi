"use client";

import { YouVersionGoalPreset, POSITIVE_GOALS, NEGATIVE_OUTCOMES } from "@/lib/constants/youversion";
import { cn } from "@/lib/utils";

interface GoalPresetPickerProps {
  onSelect: (preset: YouVersionGoalPreset) => void;
}

export function GoalPresetPicker({ onSelect }: GoalPresetPickerProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Positive Goals</p>
        <div className="flex flex-wrap gap-2">
          {POSITIVE_GOALS.map((goal) => (
            <button
              key={goal.eventName}
              type="button"
              onClick={() => onSelect(goal)}
              title={goal.description}
              className={cn(
                "px-3 py-1.5 text-xs rounded-full border font-medium transition-colors",
                goal.tier === "best"
                  ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                  : goal.tier === "very_good"
                  ? "border-green-200 bg-green-50/50 text-green-600 hover:bg-green-100"
                  : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              )}
            >
              {goal.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Negative Outcomes</p>
        <div className="flex flex-wrap gap-2">
          {NEGATIVE_OUTCOMES.map((goal) => (
            <button
              key={goal.eventName}
              type="button"
              onClick={() => onSelect(goal)}
              title={goal.description}
              className="px-3 py-1.5 text-xs rounded-full border font-medium transition-colors border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            >
              {goal.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
