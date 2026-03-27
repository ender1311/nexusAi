"use client";

import { useEffect, useRef } from "react";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";

interface ScanningAnimationProps {
  phase: string;
  progress: number;
}

const COLS = 12;
const ROWS = 8;

export function ScanningAnimation({ phase, progress }: ScanningAnimationProps) {
  const phaseRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = phaseRef.current;
    if (!el) return;
    el.style.opacity = "0";
    const t = setTimeout(() => {
      el.style.opacity = "1";
    }, 80);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/10 p-8 space-y-8">
      {/* Header */}
      <div className="text-center space-y-1">
        <p className="text-xs font-mono uppercase tracking-widest text-primary">
          Nexus AI — Active Analysis
        </p>
        <h3 className="text-lg font-semibold">Scanning in progress</h3>
      </div>

      {/* Concentric rings */}
      <div className="flex justify-center">
        <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute rounded-full border border-primary/30"
              style={{
                width: 40 + i * 30,
                height: 40 + i * 30,
                animation: `ct-ring-pulse 2s ease-in-out ${i * 0.35}s infinite`,
              }}
            />
          ))}
          <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
            <div className="h-3 w-3 rounded-full bg-primary" style={{ animation: "ct-ring-pulse 1s ease-in-out infinite" }} />
          </div>
        </div>
      </div>

      {/* Dot matrix grid */}
      <div className="flex justify-center">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        >
          {Array.from({ length: ROWS * COLS }, (_, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const delay = (col * 0.06 + row * 0.08) % 1.2;
            return (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary/30"
                style={{
                  animation: `ct-dot-sweep 1.4s ease-in-out ${delay.toFixed(2)}s infinite`,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Phase label */}
      <div className="text-center min-h-[1.5rem]">
        <p
          ref={phaseRef}
          className="font-mono text-sm text-muted-foreground transition-opacity duration-200"
        >
          {phase}
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground font-mono">
          <span>Progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress}>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
    </div>
  );
}
