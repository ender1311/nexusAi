"use client";

import { Persona } from "@/types/persona";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/mock/personas";
import { cn } from "@/lib/utils";

interface PersonaSelectorProps {
  personas: Persona[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function PersonaSelector({ personas, selected, onChange }: PersonaSelectorProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {personas.map((persona) => {
        const isSelected = selected.includes(persona.id);
        const colors = PERSONA_COLORS[persona.color];
        const Icon = PERSONA_ICON_MAP[persona.icon];

        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => toggle(persona.id)}
            className={cn(
              "flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all",
              isSelected
                ? cn("border-2", colors.border, colors.bg, `ring-2 ${colors.ring}`)
                : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50"
            )}
          >
            <div className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", colors.iconBg)}>
              {Icon && <Icon className={cn("h-3.5 w-3.5", colors.text)} />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{persona.name}</p>
              <p className={cn("text-xs", isSelected ? colors.text : "text-muted-foreground")}>{persona.label}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
