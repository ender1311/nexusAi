"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { convergenceHours, formatConvergenceTime, sliderPosToArms, armsToSliderPos } from "@/lib/convergence";
import type { FunnelStage } from "@/types/agent";

const DEFAULT_ARMS = 100;

const ROWS: {
  stage: string;
  funnelKey: FunnelStage;
  eligibility: string;
  sendsPerMonth: string;
}[] = [
  { stage: "DAU4",   funnelKey: "dau4",        eligibility: "Daily",                        sendsPerMonth: "~20–30" },
  { stage: "WAU",    funnelKey: "wau",          eligibility: "1–3×/week",                    sendsPerMonth: "~6–12"  },
  { stage: "MAU",    funnelKey: "mau",          eligibility: "~1×/month",                    sendsPerMonth: "~4"     },
  { stage: "Lapsed", funnelKey: "lapsed_dau4",  eligibility: "Rarely / re-engagement burst", sendsPerMonth: "~2"     },
];

function convergenceColor(hours: number): string {
  const days = hours / 24;
  if (days < 2) return "text-[#57a16c] font-medium";
  if (days < 14) return "text-foreground font-medium";
  if (days < 90) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-red-500 dark:text-red-400 font-medium";
}

export function ConvergenceSection() {
  const [sliderPos, setSliderPos] = useState(armsToSliderPos(DEFAULT_ARMS));
  const [inputVal, setInputVal] = useState(String(DEFAULT_ARMS));
  const arms = sliderPosToArms(sliderPos);

  const applyArms = (raw: number) => {
    const clamped = Math.max(3, Math.min(10_000, Math.round(raw)));
    setSliderPos(armsToSliderPos(clamped));
    setInputVal(String(clamped));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">How long until the bandit converges?</h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Convergence means the Beta distributions have narrowed enough that the best-performing
          variant wins draws consistently — typically after ~30–50 observations per arm. Speed
          depends on two things: how many users are in the target persona, and how often each
          user is eligible to receive a send. Funnel stage drives eligibility frequency.
        </p>
      </div>

      {/* Arms slider + custom input */}
      <div className="flex items-center gap-3 max-w-sm">
        <span className="text-xs text-muted-foreground shrink-0">Arms / variants:</span>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[sliderPos]}
          onValueChange={(v) => {
            const pos = Array.isArray(v) ? v[0] : v;
            setSliderPos(pos);
            setInputVal(String(sliderPosToArms(pos)));
          }}
          className="flex-1"
        />
        <Input
          type="number"
          min={3}
          max={10000}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={() => {
            const n = parseInt(inputVal, 10);
            applyArms(isNaN(n) ? DEFAULT_ARMS : n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = parseInt(inputVal, 10);
              applyArms(isNaN(n) ? DEFAULT_ARMS : n);
            }
          }}
          className="w-20 h-7 text-xs font-mono text-right px-2"
        />
      </div>

      {/* Convergence table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse max-w-2xl">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Funnel stage</th>
              <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Eligibility</th>
              <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Sends / user / month</th>
              <th className="text-left py-2 font-semibold text-muted-foreground">
                Convergence (10 M users,{" "}
                <span className="text-foreground">{arms.toLocaleString()} arm{arms !== 1 ? "s" : ""}</span>)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ROWS.map((row) => {
              const hours = convergenceHours(row.funnelKey, arms);
              const label = hours !== null ? formatConvergenceTime(hours) : "—";
              const colorClass = hours !== null ? convergenceColor(hours) : "text-muted-foreground";
              return (
                <tr key={row.stage}>
                  <td className="py-2 pr-4 font-medium">{row.stage}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.eligibility}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.sendsPerMonth}</td>
                  <td className={cn("py-2", colorClass)}>{label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border-l-4 border-l-amber-500 bg-muted/30 p-4 max-w-2xl">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Practical implication:</span> at 10 M+ users,
          sample size per run is never the bottleneck — eligibility frequency is. DAU4 agents converge
          within hours and can comfortably run 6–8 arms. MAU and lapsed audiences still need multiple
          eligibility cycles (weeks to months) to accumulate the per-arm evidence Thompson Sampling
          needs — keep variant counts low (2–3) for those stages.
        </p>
      </div>
    </div>
  );
}
