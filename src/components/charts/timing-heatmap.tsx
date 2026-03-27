"use client";

import { TimingHeatmapCell } from "@/types/metrics";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12a";
  if (i < 12) return `${i}a`;
  if (i === 12) return "12p";
  return `${i - 12}p`;
});

interface TimingHeatmapProps {
  data: TimingHeatmapCell[];
}

function valueToColor(value: number): string {
  if (value === 0) return "bg-muted";
  if (value < 2) return "bg-blue-100 dark:bg-blue-950";
  if (value < 4) return "bg-blue-200 dark:bg-blue-900";
  if (value < 6) return "bg-blue-400 dark:bg-blue-700";
  if (value < 8) return "bg-blue-600 dark:bg-blue-500";
  return "bg-blue-800 dark:bg-blue-300";
}

export function TimingHeatmap({ data }: TimingHeatmapProps) {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  data.forEach((cell) => {
    if (cell.day >= 0 && cell.day < 7 && cell.hour >= 0 && cell.hour < 24) {
      grid[cell.day][cell.hour] = cell.value;
    }
  });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        <div className="flex mb-1">
          <div className="w-10" />
          {HOURS.map((h, i) => (
            <div key={i} className="flex-1 text-center text-xs text-muted-foreground" style={{ minWidth: 20 }}>
              {i % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {DAYS.map((day, dayIdx) => (
          <div key={day} className="flex items-center mb-0.5">
            <div className="w-10 text-xs text-muted-foreground">{day}</div>
            {grid[dayIdx].map((value, hourIdx) => (
              <div
                key={hourIdx}
                className={cn("flex-1 h-5 rounded-sm mx-px", valueToColor(value))}
                style={{ minWidth: 20 }}
                title={`${day} ${HOURS[hourIdx]}: ${value.toFixed(1)}% conv rate`}
              />
            ))}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-muted-foreground">Lower</span>
          {["bg-muted", "bg-blue-100", "bg-blue-200", "bg-blue-400", "bg-blue-600", "bg-blue-800"].map((c, i) => (
            <div key={i} className={cn("h-3 w-6 rounded-sm", c)} />
          ))}
          <span className="text-xs text-muted-foreground">Higher conv. rate</span>
        </div>
      </div>
    </div>
  );
}
