"use client";

import { useEffect, useRef, useState } from "react";
import { initialArmStats, stepDecide, stepLearn, type ArmStats } from "@site/lib/demo/build-step-data";
import { DEMO_SOURCES, type DemoSource } from "@site/content/demo-lumen";
import { connectorLabel, contentSources } from "@site/content/connectors";
import { clampStep, toSearch } from "@site/lib/demo/url-state";
import { Step1Ingest } from "./steps/step-1-ingest";
import { Step2Features } from "./steps/step-2-features";
import { Step3Content } from "./steps/step-3-content";
import { Step4Decide } from "./steps/step-4-decide";
import { Step5Activate } from "./steps/step-5-activate";
import { Step6Learn } from "./steps/step-6-learn";

const RAIL = ["1 Hightouch", "2 Features", "3 Content", "4 Decide", "5 Braze", "6 Learn"];
const SOURCE_OPTIONS: { id: DemoSource; label: string }[] = DEMO_SOURCES.map((id) => {
  const connector = contentSources().find((c) => c.id === id);
  if (!connector) throw new Error(`No connector for demo source ${id}`);
  return { id, label: connectorLabel(connector) };
});
const INITIAL_SEED = 42;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || t.closest("[role=radiogroup]") !== null;
}

export function Walkthrough({ initialStep, initialSource }: { initialStep: number; initialSource: DemoSource }) {
  const [step, setStep] = useState(clampStep(initialStep));
  const [source, setSource] = useState<DemoSource>(initialSource);
  const [seed, setSeed] = useState(INITIAL_SEED);
  const [armStats, setArmStats] = useState<ArmStats>(() => initialArmStats(initialSource, INITIAL_SEED));

  useEffect(() => {
    const next = window.location.pathname + toSearch(step, source) + window.location.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) history.replaceState(null, "", next);
  }, [step, source]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || isTypingTarget(e.target)) return;
      if (e.key === "ArrowLeft") setStep((s) => clampStep(s - 1));
      if (e.key === "ArrowRight") setStep((s) => clampStep(s + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function changeSource(next: DemoSource) {
    if (next === source) return;
    setSource(next);
    setArmStats(initialArmStats(next, seed));
  }

  function pickAgain() {
    const next = seed + 1;
    setSeed(next);
    setArmStats(initialArmStats(source, next));
  }

  const decision = stepDecide(source, seed);
  const radioRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onRadioKeyDown(e: React.KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const last = SOURCE_OPTIONS.length - 1;
    const index = SOURCE_OPTIONS.findIndex((o) => o.id === source);
    let target: number;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") target = index === 0 ? last : index - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") target = index === last ? 0 : index + 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = last;
    else return;
    e.preventDefault();
    e.stopPropagation();
    const option = SOURCE_OPTIONS[target]!;
    changeSource(option.id);
    radioRefs.current[option.id]?.focus();
  }
  const showSourceSwitch = step >= 3 && step <= 5;
  const selected = contentSources().find((c) => c.id === source);

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-6">
      <ol className="flex flex-wrap gap-2">
        {RAIL.map((label, i) => (
          <li key={label}>
            <button aria-current={step === i + 1 ? "step" : undefined} onClick={() => setStep(clampStep(i + 1))}
              className={`rounded-md px-3 py-1 text-sm ${step === i + 1 ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{label}</button>
          </li>
        ))}
      </ol>

      {showSourceSwitch ? (
        <div role="radiogroup" aria-label="Content source" className="flex flex-wrap gap-2" onKeyDown={onRadioKeyDown}>
          {SOURCE_OPTIONS.map((o) => (
            <button key={o.id} role="radio" aria-checked={source === o.id} tabIndex={source === o.id ? 0 : -1}
              ref={(el) => { radioRefs.current[o.id] = el; }} onClick={() => changeSource(o.id)}
              className={`rounded-full px-3 py-1 text-xs ${source === o.id ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{o.label}</button>
          ))}
        </div>
      ) : null}
      {showSourceSwitch && selected?.status === "roadmap" ? (
        <p className="text-xs text-[var(--muted)]">
          Roadmap: the {selected.name} connector is being built and isn&apos;t live yet. The mapping and payload below run on Nexus&apos;s real mapping code, using sample records.
        </p>
      ) : null}

      <div>
        {step === 1 ? <Step1Ingest /> : null}
        {step === 2 ? <Step2Features /> : null}
        {step === 3 ? <Step3Content source={source} /> : null}
        {step === 4 ? <Step4Decide decision={decision} onPickAgain={pickAgain} /> : null}
        {step === 5 ? <Step5Activate source={source} chosenRef={decision.chosen.externalRef} /> : null}
        {step === 6 ? (
          <Step6Learn stats={armStats} onOutcome={(converted) => setArmStats((s) => stepLearn(s, converted))}
            onReset={() => setArmStats(initialArmStats(source, seed))} />
        ) : null}
      </div>

      <div className="flex justify-between">
        <button className="rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40" disabled={step === 1} onClick={() => setStep((s) => clampStep(s - 1))}>Back</button>
        <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={step === 6} onClick={() => setStep((s) => clampStep(s + 1))}>Next</button>
      </div>
    </div>
  );
}
