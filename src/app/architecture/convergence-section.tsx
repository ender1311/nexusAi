"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatNumber } from "@/lib/utils";
import {
  convergenceHoursForSegment,
  formatConvergenceTime,
  sliderPosToArms,
  armsToSliderPos,
  snapArms,
  observationsNeeded,
  peopleExplored,
  openRateForStage,
  OBS_PER_ARM,
} from "@/lib/convergence";
import type { FunnelStage } from "@/types/agent";

const DEFAULT_ARMS = 10;
const DEFAULT_SEGMENT = 25_000;
const DEFAULT_PERSONAS = 1;
const MAX_SEGMENT = 1_000_000_000;

const ROWS: {
  stage: string;
  funnelKey: FunnelStage;
  eligibility: string;
}[] = [
  { stage: "DAU4",   funnelKey: "dau4",        eligibility: "Daily" },
  { stage: "WAU",    funnelKey: "wau",          eligibility: "1–3×/week" },
  { stage: "MAU",    funnelKey: "mau",          eligibility: "~1×/month" },
  { stage: "Lapsed", funnelKey: "lapsed_dau4",  eligibility: "Rarely" },
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
  const [segmentInput, setSegmentInput] = useState(String(DEFAULT_SEGMENT));
  const [personasInput, setPersonasInput] = useState(String(DEFAULT_PERSONAS));

  // Results are computed from a snapshot taken when "Analyze" is clicked, so the
  // table reflects an explicit action rather than updating mid-edit.
  const [result, setResult] = useState<{ arms: number; segment: number; personas: number } | null>(null);

  // Manual arm entry accepts any integer (not snapped to 5); the slider snaps.
  const applyArmsInput = () => {
    const n = parseInt(armsInput, 10);
    const clamped = isNaN(n) ? DEFAULT_ARMS : Math.max(2, Math.min(10_000, n));
    setArms(clamped);
    setArmsInput(String(clamped));
    return clamped;
  };

  const applySegmentInput = () => {
    const n = parseInt(segmentInput, 10);
    const clamped = isNaN(n) ? DEFAULT_SEGMENT : Math.max(1, Math.min(MAX_SEGMENT, n));
    setSegmentInput(String(clamped));
    return clamped;
  };

  const applyPersonasInput = () => {
    const n = parseInt(personasInput, 10);
    const clamped = isNaN(n) ? DEFAULT_PERSONAS : Math.max(1, Math.min(50, n));
    setPersonasInput(String(clamped));
    return clamped;
  };

  const analyze = () => {
    // Commit any in-flight text edits first, then snapshot the resolved values.
    setResult({
      arms: applyArmsInput(),
      segment: applySegmentInput(),
      personas: applyPersonasInput(),
    });
  };

  // Thompson/Epsilon keep separate Beta stats per persona, so each persona is its
  // own bandit drawing from its slice of the segment and needing its own opens.
  const effectiveSegment = result ? Math.max(1, Math.floor(result.segment / result.personas)) : 0;
  const needed = result ? observationsNeeded(result.arms) * result.personas : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">How long until the bandit converges?</h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Convergence means the Beta distributions have narrowed enough that the best-performing
          variant wins draws consistently — typically after ~{OBS_PER_ARM} engaged responses (opens)
          per arm. Speed is gated by how fast <span className="text-foreground font-medium">informative</span>{" "}
          signal accrues, which depends on three things: how many users the agent can reach, how many
          variant arms split that traffic, and — the factor that bites low-engagement audiences — how
          often those users actually open. A lapsed user reached at scale still opens ~1% of the time,
          so most sends are uninformative and far more are needed.
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
            onKeyDown={(e) => { if (e.key === "Enter") analyze(); }}
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
            onKeyDown={(e) => { if (e.key === "Enter") analyze(); }}
            className="w-20 h-7 text-xs font-mono text-right px-2"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0 w-28">Personas:</span>
          <Input
            type="number"
            min={1}
            max={50}
            value={personasInput}
            onChange={(e) => setPersonasInput(e.target.value)}
            onBlur={applyPersonasInput}
            onKeyDown={(e) => { if (e.key === "Enter") analyze(); }}
            className="w-20 h-7 text-xs font-mono text-right px-2"
          />
          <span className="text-[11px] text-muted-foreground leading-tight">
            Thompson/Epsilon learn per persona — each is its own bandit
          </span>
        </div>

        <Button size="sm" onClick={analyze} className="h-8 text-xs">
          Analyze
        </Button>
      </div>

      {result && (
        <>
          {/* Stage-independent summary */}
          <div className="grid grid-cols-3 gap-3 max-w-2xl">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[11px] text-muted-foreground">Variant arms</p>
              <p className="text-lg font-semibold tabular-nums">{result.arms.toLocaleString()}</p>
              {result.personas > 1 && (
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  × {result.personas} personas
                </p>
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[11px] text-muted-foreground">Engaged signals needed</p>
              <p className="text-lg font-semibold tabular-nums">{formatNumber(needed)}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {result.personas > 1 ? `${result.personas}×${result.arms} ` : `${result.arms} `}
                arms × {OBS_PER_ARM} opens
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[11px] text-muted-foreground">Audience per bandit</p>
              <p className="text-lg font-semibold tabular-nums">{formatNumber(effectiveSegment)}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {result.personas > 1
                  ? `${formatNumber(result.segment)} ÷ ${result.personas} personas`
                  : "users reachable"}
              </p>
            </div>
          </div>

          {/* Convergence table — driven by the analyzed snapshot */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse max-w-2xl">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Funnel stage</th>
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Eligibility</th>
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Open rate</th>
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">People explored</th>
                  <th className="text-left py-2 font-semibold text-muted-foreground">
                    Convergence (
                    <span className="text-foreground">{formatNumber(result.segment)} users</span>,{" "}
                    <span className="text-foreground">{result.arms.toLocaleString()} arm{result.arms !== 1 ? "s" : ""}</span>)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ROWS.map((row) => {
                  // Each persona is its own bandit over its slice of the segment.
                  const hours = convergenceHoursForSegment(row.funnelKey, result.arms, effectiveSegment);
                  const label = hours !== null ? formatConvergenceTime(hours) : "—";
                  const colorClass = hours !== null ? convergenceColor(hours) : "text-muted-foreground";
                  const openRate = openRateForStage(row.funnelKey);
                  const explored = peopleExplored(row.funnelKey, result.arms, effectiveSegment) * result.personas;
                  const capped = explored >= result.segment;
                  return (
                    <tr key={row.stage}>
                      <td className="py-2 pr-4 font-medium">{row.stage}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{row.eligibility}</td>
                      <td className="py-2 pr-4 text-muted-foreground tabular-nums">
                        {openRate !== null ? `${Math.round(openRate * 100)}%` : "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground tabular-nums">
                        {formatNumber(explored)}{capped ? " (all)" : ""}
                      </td>
                      <td className={cn("py-2", colorClass)}>{label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border-l-4 border-l-amber-500 bg-muted/30 p-4 max-w-2xl">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Practical implication:</span> audience
              size alone never makes convergence instant — open rate and eligibility set the floor.
              Highly-engaged DAU4 users open often, so signal accrues in hours; WAU/MAU/lapsed
              audiences open rarely, so even at millions of users they need days to weeks to gather the{" "}
              {needed.toLocaleString()} engaged responses this config requires. Keep variant counts
              low (2–3) for low-engagement or small segments.
            </p>
          </div>

          <div className="rounded-lg border-l-4 border-l-red-500 bg-muted/30 p-4 max-w-2xl">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Read these as a best-case floor.</span>{" "}
              They assume variants differ by a clear margin (near-tied arms take far longer — sample
              size scales ~1/Δ² in the reward gap), an engagement/open goal (conversion goals like
              gifts have sub-1% base rates and run much slower), and they don&apos;t model the skeptical
              Beta(1,30) cold-start prior, reward-attribution lag, or daily send caps. Real
              convergence runs longer — treat these as the fastest it could plausibly go.
            </p>
          </div>
        </>
      )}

      {/* Education: factors the calculator can't show */}
      <div className="space-y-3 max-w-2xl pt-2">
        <div>
          <h3 className="text-sm font-semibold mb-1">What else moves convergence time</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The calculator models segment size, arms, eligibility, open rate, and persona count.
            Several more factors — which it can&apos;t capture — stretch the real timeline further:
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
    term: "Algorithm choice (personas)",
    detail:
      "The personas input above captures the Thompson/Epsilon split (each persona is its own bandit), but assumes an even split — a thin persona converges last. LinUCB instead shares one contextual model and is more sample-efficient when personas behave alike, so it can beat the per-persona estimate.",
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
      "Fresh arms cold-start at a skeptical Beta(1,30) prior (implied ~3% rate), so early sends barely move the posterior and the first dozens of opens mostly just overcome the prior. Cloned variants warm-start from their source template's accumulated history, so they converge faster than a brand-new arm.",
  },
];
