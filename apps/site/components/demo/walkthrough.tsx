"use client";

import { useEffect, useState } from "react";
import { INITIAL_ARM_STATS, stepDecide, stepLearn, type ArmStats } from "@site/lib/demo/build-step-data";
import type { DemoSource } from "@site/content/demo-lumen";
import { clampStep, toSearch } from "@site/lib/demo/url-state";
import { Step1Ingest } from "./steps/step-1-ingest";
import { Step2Features } from "./steps/step-2-features";
import { Step3Content } from "./steps/step-3-content";
import { Step4Decide } from "./steps/step-4-decide";
import { Step5Activate } from "./steps/step-5-activate";
import { Step6Learn } from "./steps/step-6-learn";

const RAIL = ["1 Hightouch", "2 Features", "3 Content", "4 Decide", "5 Braze", "6 Learn"];
const SOURCE_OPTIONS: { id: DemoSource; label: string }[] = [
  { id: "contentful", label: "Contentful" },
  { id: "sanity", label: "Sanity" },
  { id: "generic-json", label: "Generic JSON" },
  { id: "braze-catalog", label: "Braze Catalog" },
  { id: "nexus-library", label: "Nexus library" },
];
const INITIAL_SEED = 42;

function initialStatsFor(source: DemoSource, seed: number): ArmStats {
  return INITIAL_ARM_STATS[stepDecide(source, seed).chosen.externalRef]!;
}

export function Walkthrough({ initialStep, initialSource }: { initialStep: number; initialSource: DemoSource }) {
  const [step, setStep] = useState(clampStep(initialStep));
  const [source, setSource] = useState<DemoSource>(initialSource);
  const [seed, setSeed] = useState(INITIAL_SEED);
  const [armStats, setArmStats] = useState<ArmStats>(() => initialStatsFor(initialSource, INITIAL_SEED));

  useEffect(() => {
    history.replaceState(null, "", toSearch(step, source));
  }, [step, source]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setStep((s) => clampStep(s - 1));
      if (e.key === "ArrowRight") setStep((s) => clampStep(s + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function changeSource(next: DemoSource) {
    setSource(next);
    setArmStats(initialStatsFor(next, seed));
  }

  function pickAgain() {
    const next = seed + 1;
    setSeed(next);
    setArmStats(initialStatsFor(source, next));
  }

  const chosen = stepDecide(source, seed).chosen;
  const showSourceSwitch = step >= 3 && step <= 5;

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-6">
      <ol className="flex flex-wrap gap-2">
        {RAIL.map((label, i) => (
          <li key={label}>
            <button aria-current={step === i + 1 ? "step" : undefined} onClick={() => setStep(i + 1 as 1)}
              className={`rounded-md px-3 py-1 text-sm ${step === i + 1 ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{label}</button>
          </li>
        ))}
      </ol>

      {showSourceSwitch ? (
        <div role="radiogroup" aria-label="Content source" className="flex flex-wrap gap-2">
          {SOURCE_OPTIONS.map((o) => (
            <button key={o.id} role="radio" aria-checked={source === o.id} onClick={() => changeSource(o.id)}
              className={`rounded-full px-3 py-1 text-xs ${source === o.id ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{o.label}</button>
          ))}
        </div>
      ) : null}

      <div>
        {step === 1 ? <Step1Ingest /> : null}
        {step === 2 ? <Step2Features /> : null}
        {step === 3 ? <Step3Content source={source} /> : null}
        {step === 4 ? <Step4Decide source={source} seed={seed} onPickAgain={pickAgain} /> : null}
        {step === 5 ? <Step5Activate source={source} chosenRef={chosen.externalRef} /> : null}
        {step === 6 ? (
          <Step6Learn stats={armStats} onOutcome={(converted) => setArmStats((s) => stepLearn(s, converted))}
            onReset={() => setArmStats(initialStatsFor(source, seed))} />
        ) : null}
      </div>

      <div className="flex justify-between">
        <button className="rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40" disabled={step === 1} onClick={() => setStep((s) => clampStep(s - 1))}>Back</button>
        <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={step === 6} onClick={() => setStep((s) => clampStep(s + 1))}>Next</button>
      </div>
    </div>
  );
}
