"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { cn, formatNumber } from "@/lib/utils";
import {
  convergenceHoursForSegment,
  formatConvergenceTime,
  sliderPosToArms,
  armsToSliderPos,
  snapArms,
  observationsNeeded,
  peopleExplored,
  OBS_PER_ARM,
} from "@/lib/convergence";
import type { FunnelStage } from "@/types/agent";

const DEFAULT_ARMS = 10;
const DEFAULT_SEGMENT = 25_000;
const MAX_SEGMENT = 1_000_000_000;

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
  if (days < 90) return "text-[#57a16c] font-medium";       // < 3 months: green
  if (days < 180) return "text-amber-500 dark:text-amber-400 font-medium"; // 3–6 months: yellow
  return "text-red-500 dark:text-red-400 font-medium";       // > 6 months: red
}

export function ConvergenceSection() {
  const [arms, setArms] = useState(DEFAULT_ARMS);
  const [armsInput, setArmsInput] = useState(String(DEFAULT_ARMS));
  const [segment, setSegment] = useState(DEFAULT_SEGMENT);
  const [segmentInput, setSegmentInput] = useState(String(DEFAULT_SEGMENT));

  // Manual arm entry accepts any integer (not snapped to 5); the slider snaps.
  const applyArmsInput = () => {
    const n = parseInt(armsInput, 10);
    const clamped = isNaN(n) ? DEFAULT_ARMS : Math.max(2, Math.min(10_000, n));
    setArms(clamped);
    setArmsInput(String(clamped));
  };

  const applySegmentInput = () => {
    const n = parseInt(segmentInput, 10);
    const clamped = isNaN(n) ? DEFAULT_SEGMENT : Math.max(1, Math.min(MAX_SEGMENT, n));
    setSegment(clamped);
    setSegmentInput(String(clamped));
  };

  const explored = peopleExplored(arms, segment);
  const needed = observationsNeeded(arms);
  const recycleFactor = segment > 0 ? needed / segment : 0;
  const segmentIsBottleneck = needed > segment;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">How long until the bandit converges?</h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Convergence means the Beta distributions have narrowed enough that the best-performing
          variant wins draws consistently — typically after ~{OBS_PER_ARM} observations per arm.
          Each eligibility cycle delivers up to one send per user in the segment, so speed depends
          on three things: how many users the agent can reach, how many variant arms split that
          traffic, and how often each user is eligible (funnel stage).
        </p>
      </div>

      {/* Inputs: segment size + arms (slider snaps to 5, input is any integer) */}
      <div className="space-y-3 max-w-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0 w-28">Segment size:</span>
          <Input
            type="number"
            min={1}
            max={MAX_SEGMENT}
            value={segmentInput}
            onChange={(e) => setSegmentInput(e.target.value)}
            onBlur={applySegmentInput}
            onKeyDown={(e) => { if (e.key === "Enter") applySegmentInput(); }}
            className="w-32 h-7 text-xs font-mono text-right px-2"
          />
          <span className="text-xs text-muted-foreground">users</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0 w-28">Arms / variants:</span>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[armsToSliderPos(arms)]}
            onValueChange={(v) => {
              const pos = Array.isArray(v) ? v[0] : v;
              const snapped = snapArms(sliderPosToArms(pos));
              setArms(snapped);
              setArmsInput(String(snapped));
            }}
            className="flex-1"
          />
          <Input
            type="number"
            min={2}
            max={10000}
            value={armsInput}
            onChange={(e) => setArmsInput(e.target.value)}
            onBlur={applyArmsInput}
            onKeyDown={(e) => { if (e.key === "Enter") applyArmsInput(); }}
            className="w-20 h-7 text-xs font-mono text-right px-2"
          />
        </div>
      </div>

      {/* Stage-independent summary */}
      <div className="grid grid-cols-3 gap-3 max-w-2xl">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-[11px] text-muted-foreground">Variant arms</p>
          <p className="text-lg font-semibold tabular-nums">{arms.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-[11px] text-muted-foreground">People explored</p>
          <p className="text-lg font-semibold tabular-nums">{formatNumber(explored)}</p>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {segmentIsBottleneck
              ? `entire segment · re-sent ~${recycleFactor.toFixed(1)}×`
              : `of ${formatNumber(segment)} · ${OBS_PER_ARM}/arm`}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-[11px] text-muted-foreground">Observations needed</p>
          <p className="text-lg font-semibold tabular-nums">{formatNumber(needed)}</p>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            {arms.toLocaleString()} arms × {OBS_PER_ARM}
          </p>
        </div>
      </div>

      {/* Convergence table — now driven by the segment-size input */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse max-w-2xl">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Funnel stage</th>
              <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Eligibility</th>
              <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Sends / user / month</th>
              <th className="text-left py-2 font-semibold text-muted-foreground">
                Convergence (
                <span className="text-foreground">{formatNumber(segment)} users</span>,{" "}
                <span className="text-foreground">{arms.toLocaleString()} arm{arms !== 1 ? "s" : ""}</span>)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ROWS.map((row) => {
              const hours = convergenceHoursForSegment(row.funnelKey, arms, segment);
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
          <span className="font-semibold text-foreground">Practical implication:</span> with a large
          segment, sample size is never the bottleneck — convergence is near-instant and eligibility
          frequency is the only floor. The squeeze appears when the segment is small or the arm count
          is high: the {needed.toLocaleString()} observations this config needs get rationed across
          eligibility cycles, so lapsed/low-frequency audiences can take weeks to months. Keep variant
          counts low (2–3) for small or infrequently-eligible segments.
        </p>
      </div>

      {/* Education: factors the calculator can't show */}
      <div className="space-y-3 max-w-2xl pt-2">
        <div>
          <h3 className="text-sm font-semibold mb-1">What else moves convergence time</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The calculator models the three mechanical levers — segment size, arms, and eligibility.
            In practice several more factors stretch or compress the real timeline:
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CONVERGENCE_FACTORS.map((f) => (
            <div key={f.term} className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold text-foreground mb-0.5">{f.term}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{f.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Education: lifespan of a converged winner */}
      <div className="space-y-3 max-w-2xl pt-2">
        <div>
          <h3 className="text-sm font-semibold mb-1">After convergence — how long does a winner last?</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Convergence is a snapshot, not a verdict. A winning variant decays over time from{" "}
            <span className="text-foreground font-medium">creative wearout</span> (the audience
            habituates to a message it keeps seeing) and{" "}
            <span className="text-foreground font-medium">audience drift</span> (new users enter,
            others lapse, and seasonality shifts what resonates) — most pronounced on
            continuous-enrollment agents whose cohort is always turning over.
          </p>
        </div>
        <div className="rounded-lg border-l-4 border-l-red-500 bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Nexus caveat:</span> arm statistics
            accumulate cumulatively — there is no decay, half-life, or sliding window on the win/loss
            counts. A winner with thousands of historical wins won&apos;t be unseated quickly by a recent
            slump, because the old evidence drowns out the new signal. The bandit will{" "}
            <span className="text-foreground font-medium">not</span> self-correct fast when a message
            fatigues, so wearout is your responsibility to manage, not the engine&apos;s.
          </p>
        </div>
        <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Rule of thumb:</span> treat a converged
            winner as fresh for ~<span className="text-foreground font-medium">4–8 weeks</span> of
            evergreen engagement copy — shorter for time-sensitive, seasonal, or promotional sends.
            Keep <span className="text-foreground font-medium">1–2 challenger arms</span> always
            running so there is a live alternative, and retire or clone in fresh creative when you
            suspect fatigue rather than waiting for the numbers to turn.
          </p>
        </div>
      </div>
    </div>
  );
}

const CONVERGENCE_FACTORS: { term: string; detail: string }[] = [
  {
    term: "Effect size & base rate",
    detail:
      "The ~40 obs/arm rule assumes variants differ clearly at a moderate reward rate. Near-tied variants (3.0% vs 3.1% open) may never separate; rare rewards like gift conversions (<1%) can need 10–100× more data.",
  },
  {
    term: "Reward attribution lag",
    detail:
      "An arm can't be credited until the outcome lands — opens within hours, gifts and subscriptions over days. Wall-clock convergence is gated by this feedback window, not just send speed.",
  },
  {
    term: "Persona segmentation",
    detail:
      "Thompson & Epsilon-Greedy keep separate Beta stats per persona, so a 5-persona agent is effectively 5 bandits splitting the segment ~5 ways. LinUCB shares one contextual model and is more sample-efficient when personas behave alike.",
  },
  {
    term: "Reward variance",
    detail:
      "A binary open/no-open signal converges faster than variable-magnitude rewards. gift_given is log-scaled dollar amounts — a noisier signal that needs more samples to pin down.",
  },
  {
    term: "Real vs theoretical throughput",
    detail:
      "Daily send caps, frequency caps, quiet hours, blackout dates, and smart suppression all cut actual sends per cycle below the raw segment size the calculator assumes.",
  },
  {
    term: "Cold-start priors",
    detail:
      "Fresh arms start at an uninformed Beta(1,1) prior. Cloned variants warm-start from their source template's accumulated history, so they converge faster than a brand-new arm.",
  },
];
