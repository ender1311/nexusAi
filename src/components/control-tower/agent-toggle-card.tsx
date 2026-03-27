"use client";

import {
  Sparkles,
  Clock,
  Radio,
  ShieldCheck,
  DollarSign,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ControlAgent } from "@/lib/mock/control-tower";

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Clock,
  Radio,
  ShieldCheck,
  DollarSign,
  Rocket,
};

interface AgentToggleCardProps {
  agent: ControlAgent;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

export function AgentToggleCard({
  agent,
  enabled,
  onToggle,
  disabled = false,
}: AgentToggleCardProps) {
  const Icon = ICON_MAP[agent.icon] ?? Sparkles;

  return (
    <Card
      className={cn(
        "transition-all duration-300",
        enabled
          ? "border-l-2 border-l-primary shadow-[0_0_15px_rgba(255,61,77,0.15)]"
          : "opacity-70",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      <CardContent className="flex items-start gap-3 py-3">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            enabled ? "bg-primary/10" : "bg-muted"
          )}
        >
          <Icon
            className="h-4 w-4"
            style={{ color: enabled ? agent.color : undefined }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{agent.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {agent.description}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
          className="mt-0.5 shrink-0"
        />
      </CardContent>
    </Card>
  );
}
