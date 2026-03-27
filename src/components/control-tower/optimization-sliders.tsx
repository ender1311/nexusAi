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

export function OptimizationSliders({
  weights,
  onChange,
  disabled = false,
}: OptimizationSlidersProps) {
  const total = optimizationParams.reduce((s, p) => s + (weights[p.id] ?? 0), 0);
  // Each slider can go up to 100 minus 1% reserved for each of the other 3
  const otherCount = optimizationParams.length - 1;
  const maxPerSlider = 100 - otherCount;

  return (
    <Card className={cn(disabled && "opacity-50 pointer-events-none")}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Optimization Weights</CardTitle>
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              total === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            )}
          >
            {total}% / 100%
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {optimizationParams.map((param) => {
          const weight = weights[param.id] ?? 25;
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
                <span className="font-mono text-xs tabular-nums shrink-0">
                  {weight}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{param.description}</p>
              <Slider
                value={[weight]}
                min={0}
                max={maxPerSlider}
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
