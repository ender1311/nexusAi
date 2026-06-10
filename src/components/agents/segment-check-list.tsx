"use client";

import { cn } from "@/lib/utils";

export type SegmentOption = { name: string; userCount: number; assignedTo: string | null };

export function SegmentCheckList({
  segments,
  selected,
  currentAgentTargetNames,
  onChange,
}: {
  segments: SegmentOption[];
  selected: string[];
  currentAgentTargetNames: string[];
  onChange: (next: string[]) => void;
}) {
  if (segments.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No segments synced yet — run a Hightouch segment sync first.</p>;
  }
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="max-h-72 overflow-y-auto">
        {segments.map((s) => {
          const isSelected = selected.includes(s.name);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => {
                onChange(isSelected ? selected.filter((n) => n !== s.name) : [...selected, s.name]);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b last:border-b-0 cursor-pointer",
                isSelected ? "bg-primary/5 text-foreground" : "hover:bg-muted/50",
              )}
            >
              <span className={cn(
                "h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center",
                isSelected ? "bg-primary border-primary" : "border-input bg-background",
              )}>
                {isSelected && (
                  <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.userCount >= 1000 ? `${(s.userCount / 1000).toFixed(0)}K` : s.userCount} users
                  {s.assignedTo && !currentAgentTargetNames.includes(s.name)
                    ? ` · also targeted by ${s.assignedTo}`
                    : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        {segments.length} segment{segments.length === 1 ? "" : "s"}
        {selected.length > 0 ? ` · ${selected.length} selected` : ""}
      </div>
    </div>
  );
}
