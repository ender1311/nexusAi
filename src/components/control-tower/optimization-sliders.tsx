"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { optimizationParams } from "@/lib/control-tower/projection";

function clamp01to100(v: number, fallback: number): number {
  const base = Number.isFinite(v) ? v : fallback;
  const n = Math.round(base);
  return Math.min(100, Math.max(0, n));
}

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
  const total = optimizationParams.reduce(
    (s, p) => s + clamp01to100(weights[p.id] ?? 0, 0),
    0
  );

  return (
    <Card className={cn(disabled && "opacity-50 pointer-events-none")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Optimization Weights</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Each slider is 0–100%. They do not need to add up to 100%.
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-muted-foreground shrink-0 pt-0.5">
            Total {total}%
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {optimizationParams.map((param) => {
          const weight = clamp01to100(weights[param.id] ?? 0, 25);
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
                max={100}
                step={1}
                onValueChange={(v) => {
                  const raw = Array.isArray(v) ? v[0] : v;
                  onChange(param.id, typeof raw === "number" ? raw : 0);
                }}
                disabled={disabled}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
