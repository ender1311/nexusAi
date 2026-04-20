"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { optimizationParams, type OptimizationConfig } from "@/lib/mock/control-tower";
import { ShieldCheck } from "lucide-react";

interface OptimizationObjectiveProps {
  config: OptimizationConfig;
  onChange: (config: OptimizationConfig) => void;
  disabled?: boolean;
}

export function OptimizationObjective({
  config,
  onChange,
  disabled = false,
}: OptimizationObjectiveProps) {
  const primaryParam = optimizationParams.find((p) => p.id === config.primaryObjective);
  const guardrailParams = optimizationParams.filter((p) => p.id !== config.primaryObjective);

  const setPrimary = (id: string) => {
    // Move old primary into guardrails with its baseline as default threshold
    const oldPrimary = optimizationParams.find((p) => p.id === config.primaryObjective);
    const newGuardrails = { ...config.guardrails };

    // Add old primary as a guardrail at its baseline value
    if (oldPrimary) {
      newGuardrails[oldPrimary.id] = oldPrimary.baseline;
    }
    // Remove new primary from guardrails
    delete newGuardrails[id];

    onChange({ primaryObjective: id, guardrails: newGuardrails });
  };

  const setGuardrail = (id: string, value: number) => {
    onChange({ ...config, guardrails: { ...config.guardrails, [id]: value } });
  };

  return (
    <Card className={cn(disabled && "opacity-50 pointer-events-none")}>
      <CardHeader>
        <CardTitle>Optimization Objective</CardTitle>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          Pick one primary goal. Set guardrails to keep other metrics in bounds.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Primary objective selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Primary Goal
          </label>
          <Select value={config.primaryObjective} onValueChange={(v) => v && setPrimary(v)} disabled={disabled}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {optimizationParams.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    {p.label}
                    <span className="text-xs text-muted-foreground">↑ {p.direction}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {primaryParam && (
            <p className="text-xs text-muted-foreground">{primaryParam.description}</p>
          )}
        </div>

        {/* Guardrails */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Guardrails
            </label>
          </div>

          {guardrailParams.map((param) => {
            const threshold = config.guardrails[param.id] ?? param.baseline;
            const label = param.direction === "minimize" ? "stay below" : "stay above";
            const prefix = param.unit === "$/user" ? "$" : "";
            const suffix = param.unit === "%" ? "%" : "";

            return (
              <div key={param.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{param.label}</p>
                  <p className="text-xs text-muted-foreground">must {label}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {prefix && (
                    <span className="text-xs text-muted-foreground">{prefix}</span>
                  )}
                  <input
                    type="number"
                    value={threshold}
                    step={param.unit === "$/user" ? 0.01 : 0.1}
                    min={0}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v)) setGuardrail(param.id, v);
                    }}
                    disabled={disabled}
                    className="w-16 rounded-md border bg-background px-2 py-1 text-right text-sm font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {suffix && (
                    <span className="text-xs text-muted-foreground">{suffix}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
