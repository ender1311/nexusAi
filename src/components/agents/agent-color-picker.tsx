"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_PALETTE } from "@/types/agent";

interface AgentColorPickerProps {
  agentId: string;
  currentColor: string;
  usedColors: string[];
}

export function AgentColorPicker({ agentId, currentColor, usedColors }: AgentColorPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentColor);
  const [saving, setSaving] = useState<string | null>(null);

  async function pick(hex: string) {
    if (hex === selected || saving) return;
    setSaving(hex);
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: hex }),
      });
      setSelected(hex);
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Color</label>
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border border-black/10"
            style={{ backgroundColor: selected }}
          />
          {selected}
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {AGENT_PALETTE.map((hex) => {
          const isCurrent = hex === selected;
          const isUsed = usedColors.includes(hex) && !isCurrent;
          return (
            <button
              key={hex}
              title={isUsed ? `${hex} (used)` : hex}
              disabled={saving !== null}
              onClick={() => pick(hex)}
              className={cn(
                "h-7 w-7 rounded-md border-2 transition-all relative flex items-center justify-center",
                isCurrent
                  ? "border-foreground scale-110 shadow-md"
                  : "border-transparent hover:scale-110 hover:border-foreground/30",
                saving === hex && "opacity-60",
              )}
              style={{ backgroundColor: hex }}
            >
              {isCurrent && <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />}
              {isUsed && !isCurrent && (
                <span
                  className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-white/80 border border-black/20"
                  title="Used by another agent"
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Small dot = already used by another agent.
      </p>
    </div>
  );
}
