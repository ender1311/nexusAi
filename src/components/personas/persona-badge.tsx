import { Persona } from "@/types/persona";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/persona-display";
import { cn } from "@/lib/utils";

interface PersonaBadgeProps {
  persona: Persona;
  size?: "sm" | "md";
}

export function PersonaBadge({ persona, size = "sm" }: PersonaBadgeProps) {
  const colors = PERSONA_COLORS[persona.color];
  const Icon = PERSONA_ICON_MAP[persona.icon];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        colors.bg,
        colors.text,
        colors.border,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
    >
      {Icon && <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />}
      {persona.name}
    </span>
  );
}
