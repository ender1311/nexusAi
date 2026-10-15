"use client";
import { useMemo, useState } from "react";
import { connectorLabel, senders, sources } from "@site/content/connectors";
import { PRESETS, getPreset } from "@site/lib/simulator/presets";
import { simulate } from "@site/lib/simulator/simulate";
import type { AlgorithmId, DecisionSample, SimulationResult } from "@site/lib/simulator/types";
import { MetricLine, TrafficChart } from "./charts";
import { FlowDiagram } from "./flow-diagram";
import { usePlayback, type Speed } from "./use-playback";

const ALGORITHMS: { id: AlgorithmId; name: string; blurb: string }[] = [
  { id: "thompson", name: "Thompson sampling", blurb: "Keeps a belief about each message and tries the ones that might be best." },
  { id: "epsilon", name: "Epsilon-greedy", blurb: "Sends the current leader, and explores at random 10% of the time." },
  { id: "linucb", name: "LinUCB (contextual)", blurb: "Learns which message wins for each kind of user, not just on average." },
];

const GLOBAL_WINNER_NOTE =
  "Thompson and epsilon-greedy here learn one overall winner; LinUCB learns per user. (In production Nexus can also segment Thompson by persona.)";

function formatLift(lift: number | null): string {
  if (lift === null) return "—";
  return `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(0)}%`;
}

function describeUncertainty(algorithm: AlgorithmId, s: DecisionSample): string {
  if (algorithm === "thompson") return ` ± ${(s.uncertainty * 100).toFixed(1)}% (95% interval)`;
  if (algorithm === "linucb") return ` + ${s.uncertainty.toFixed(3)} exploration bonus`;
  return "";
}

export function Simulator() {
  const [sourceId, setSourceId] = useState("snowflake");
  const [senderId, setSenderId] = useState("iterable");
  const [presetId, setPresetId] = useState("winback");
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("thompson");
  const [seed, setSeed] = useState(1);
  const [showTruth, setShowTruth] = useState(false);

  const preset = getPreset(presetId);
  const result = useMemo<SimulationResult | Error>(() => {
    try { return simulate(preset, algorithm, seed); } catch (e) { return e instanceof Error ? e : new Error("Simulation failed"); }
  }, [preset, algorithm, seed]);
  const playback = usePlayback(preset.days, `${presetId}:${algorithm}:${seed}`);

  const source = sources().find((c) => c.id === sourceId)!;
  const sender = senders().find((c) => c.id === senderId)!;
  const select = "rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm";

  if (result instanceof Error) {
    return <p role="alert" className="text-sm text-red-400">The simulator hit an error. Reload the page to try again.</p>;
  }
  const started = playback.day >= 1;
  const finished = playback.day >= preset.days;
  const visible = result.days.slice(0, Math.max(1, playback.day));
  const today = visible.at(-1)!;

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Data source
          <select className={select} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Sender
          <select className={select} value={senderId} onChange={(e) => setSenderId(e.target.value)}>
            {senders().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Use case
          <select className={select} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Algorithm
          <select className={select} value={algorithm} onChange={(e) => setAlgorithm(e.target.value as AlgorithmId)}>
            {ALGORITHMS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>

      <FlowDiagram source={source.name} sender={sender.name} active={playback.playing} />
      <div className="space-y-1">
        <p className="text-sm text-[var(--muted)]">{preset.description} {ALGORITHMS.find((a) => a.id === algorithm)!.blurb}</p>
        {(algorithm === "thompson" || algorithm === "epsilon") && (
          <p className="text-xs text-[var(--muted)]">{GLOBAL_WINNER_NOTE}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {playback.playing
          ? <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={playback.pause}>Pause</button>
          : <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={playback.play}>{finished ? "Replay" : playback.day === 0 ? "Run" : "Resume"}</button>}
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={playback.reset}>Reset</button>
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => { playback.reset(); playback.play(); }}>Replay</button>
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => setSeed((s) => s + 1)}>New audience</button>
        <span className="ml-auto flex gap-1 text-xs">
          {([1, 2, 4] as Speed[]).map((s) => (
            <button key={s} aria-pressed={playback.speed === s} onClick={() => playback.setSpeed(s)}
              className={`rounded px-2 py-1 ${playback.speed === s ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{s}×</button>
          ))}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Day" value={`${playback.day} / ${preset.days}`} />
        <Stat label="Conversion rate" value={started ? `${(today.cumulativeRate * 100).toFixed(2)}%` : "—"} />
        <Stat label="Lift vs. 10% random-split control" value={started ? formatLift(today.liftVsHoldout) : "—"}
          good={started && today.liftVsHoldout !== null && today.liftVsHoldout > 0} note="Simulated · varies by audience" />
      </div>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Traffic share by message</h4>
        <TrafficChart days={visible} variants={preset.variants} />
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <section><h4 className="mb-2 text-sm font-semibold">Lift vs. control</h4>
          <MetricLine days={visible} dataKey="liftVsHoldout" label="Lift" format={(v) => `${Math.round(v * 100)}%`} /></section>
        <section><h4 className="mb-2 text-sm font-semibold">Regret (conversions lost vs. always picking the best)</h4>
          <MetricLine days={visible} dataKey="cumulativeRegret" label="Regret" format={(v) => v.toFixed(0)} /></section>
      </div>

      {started && preset.segments.length > 1 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold">What each segment is getting today</h4>
          <ul className="grid gap-2 sm:grid-cols-3 text-sm">
            {preset.segments.map((s) => {
              const v = preset.variants.find((x) => x.id === today.topVariantBySegment[s.id])!;
              return <li key={s.id} className="rounded-md border border-[var(--border)] p-2"><span className="text-[var(--muted)]">{s.label}:</span> {v.id} · {v.label}</li>;
            })}
          </ul>
        </section>
      )}

      <section aria-live="polite">
        <h4 className="mb-2 text-sm font-semibold">Why this decision?</h4>
        {!started && <p className="text-xs text-[var(--muted)]">Press Run to start</p>}
        <ul className="space-y-1 font-mono text-xs text-[var(--muted)]">
          {started && today.samples.slice(0, 4).map((s) => (
            <li key={s.userNumber}>
              user {s.userNumber} → {s.variantId}{s.explore ? " (exploring)" : ""}: estimated conversion {(s.estimate * 100).toFixed(1)}%
              {describeUncertainty(algorithm, s)}
            </li>
          ))}
        </ul>
      </section>

      <details open={showTruth} onToggle={(e) => setShowTruth((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm">Show the hidden truth (simulated conversion rates)</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead><tr><th>Message</th>{preset.segments.map((s) => <th key={s.id}>{s.label}</th>)}</tr></thead>
          <tbody>
            {preset.variants.map((v) => (
              <tr key={v.id}><td>{v.id} · {v.label}: <span className="text-[var(--muted)]">“{v.copy}”</span></td>
                {v.rates.map((r, i) => <td key={i}>{(r * 100).toFixed(1)}%</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--muted)]">Simulated data. The algorithms are Nexus&apos;s production engine, running in your browser.</p>
      </details>
    </div>
  );
}

function Stat({ label, value, good, note }: { label: string; value: string; good?: boolean; note?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`text-2xl font-semibold ${good ? "text-[var(--good)]" : ""}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-[var(--muted)]">{note}</div>}
    </div>
  );
}
