"use client";

import { Check } from "lucide-react";
import {
  YouVersionGoalPreset,
  GoalColorGroup,
  POSITIVE_GOALS,
  NEGATIVE_OUTCOMES,
  INTERACTION_GOALS,
  goalColorGroup,
} from "@/lib/constants/youversion";
import { cn } from "@/lib/utils";

interface GoalPresetPickerProps {
  onSelect: (preset: YouVersionGoalPreset) => void;
  selectedEventNames?: string[];
}

const CHIP_CLASSES: Record<GoalColorGroup, string> = {
  green: "border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50",
  blue: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50",
  red: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50",
};

function PresetChips({
  goals,
  selected,
  onSelect,
}: {
  goals: YouVersionGoalPreset[];
  selected: Set<string>;
  onSelect: (preset: YouVersionGoalPreset) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {goals.map((goal) => {
        const isSelected = selected.has(goal.eventName);
        return (
          <button
            key={goal.eventName}
            type="button"
            onClick={() => onSelect(goal)}
            disabled={isSelected}
            title={goal.description}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border font-medium transition-colors",
              CHIP_CLASSES[goalColorGroup(goal)],
              isSelected && "opacity-60 cursor-default",
            )}
          >
            {isSelected && <Check className="h-3 w-3" />}
            {goal.label}
          </button>
        );
      })}
    </div>
  );
}

export function GoalPresetPicker({ onSelect, selectedEventNames = [] }: GoalPresetPickerProps) {
  const selected = new Set(selectedEventNames);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Positive Goals</p>
        <PresetChips goals={POSITIVE_GOALS} selected={selected} onSelect={onSelect} />
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Negative Outcomes</p>
        <PresetChips goals={NEGATIVE_OUTCOMES} selected={selected} onSelect={onSelect} />
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Feature Activation</p>
        <PresetChips goals={INTERACTION_GOALS} selected={selected} onSelect={onSelect} />
      </div>
    </div>
  );
}
