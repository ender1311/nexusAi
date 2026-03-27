"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PredictionResult } from "@/lib/mock/control-tower";

function useAnimatedCounter(target: number, duration = 1000) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;
    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setValue(target);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}

interface ResultCardProps {
  result: PredictionResult;
  index: number;
}

function ResultCard({ result, index }: ResultCardProps) {
  const animatedPredicted = useAnimatedCounter(result.predicted, 1200);

  const isImprovement =
    result.direction === "maximize"
      ? result.predicted > result.current
      : result.predicted < result.current;

  const deltaRaw = result.predicted - result.current;
  const deltaSign = deltaRaw >= 0 ? "+" : "";
  const deltaDisplay = result.direction === "minimize"
    ? deltaRaw <= 0 ? `${deltaSign}${result.format(deltaRaw).replace(/[^0-9.-]/g, "")}${result.unit}` : `+${result.format(Math.abs(deltaRaw)).replace(/[^0-9.-]/g, "")}${result.unit}`
    : `${deltaSign}${result.format(Math.abs(deltaRaw)).replace(/[^0-9.-]/g, "")}${result.unit}`;

  // Comparison bar widths
  const maxVal = Math.max(result.confidenceHigh, result.predicted, result.current);
  const currentPct = (result.current / maxVal) * 100;
  const predictedPct = (result.predicted / maxVal) * 100;

  return (
    <Card
      className="overflow-visible"
      style={{
        animation: `ct-fade-up 0.5s ease-out ${index * 150}ms both`,
      }}
    >
      <CardContent className="space-y-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{result.label}</p>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              isImprovement
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            )}
          >
            {isImprovement ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {deltaDisplay}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Predicted</p>
          <p
            className="font-mono text-2xl font-bold tabular-nums"
            style={{ animation: "ct-number-glow 2s ease-in-out 1.2s infinite" }}
          >
            {result.format(animatedPredicted)}
          </p>
          <p className="text-xs text-muted-foreground">
            CI: {result.format(result.confidenceLow)} – {result.format(result.confidenceHigh)}
          </p>
        </div>

        {/* Comparison bars */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-muted-foreground shrink-0">Current</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-muted-foreground/50 transition-all duration-700"
                style={{ width: `${currentPct}%` }}
              />
            </div>
            <span className="w-14 text-xs text-right font-mono text-muted-foreground shrink-0">
              {result.format(result.current)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-muted-foreground shrink-0">Predicted</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-1000",
                  isImprovement ? "bg-emerald-500" : "bg-red-500"
                )}
                style={{ width: `${predictedPct}%` }}
              />
            </div>
            <span className="w-14 text-xs text-right font-mono shrink-0">
              {result.format(result.predicted)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface PredictionResultsProps {
  results: PredictionResult[];
}

export function PredictionResults({ results }: PredictionResultsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Predicted Impact</h3>
        <span className="text-xs font-mono text-muted-foreground">
          Based on enabled agents + weights
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {results.map((result, i) => (
          <ResultCard key={result.paramId} result={result} index={i} />
        ))}
      </div>
    </div>
  );
}
