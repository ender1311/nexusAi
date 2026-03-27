"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { optimizationParams } from "@/lib/mock/control-tower";

interface OptimizationSlidersProps {
  weights: Record<string, number>;
  onChange: (id: string, value: number) => void;
  disabled?: boolean;
}

function priorityLabel(value: number): { label: string; className: string } {
  if (value <= 20) return { label: "Low", className: "text-muted-foreground" };
  if (value <= 50) return { label: "Medium", className: "text-amber-600 dark:text-amber-400" };
  if (value <= 80) return { label: "High", className: "text-emerald-600 dark:text-emerald-400" };
  return { label: "Critical", className: "text-primary" };
}

export function OptimizationSliders({
  weights,
  onChange,
  disabled = false,
}: OptimizationSlidersProps) {
  return (
    <Card className={cn(disabled && "opacity-50 pointer-events-none")}>
      <CardHeader>
        <CardTitle>Optimization Weights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {optimizationParams.map((param) => {
          const weight = weights[param.id] ?? 75;
          const priority = priorityLabel(weight);
          return (
            <div key={param.id} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{param.label}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-xs",
                      param.direction === "maximize"
                        ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : "border-amber-500/30 text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {param.direction}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("text-xs font-medium", priority.className)}>
                    {priority.label}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {weight}%
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{param.description}</p>
              <Slider
                value={[weight]}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => onChange(param.id, Array.isArray(v) ? v[0] : v)}
                disabled={disabled}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
