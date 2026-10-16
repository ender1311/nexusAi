"use client";
import { useMemo, useState } from "react";
import { connectorLabel, senders, sources } from "@site/content/connectors";
import { PRESETS, getPreset } from "@site/lib/simulator/presets";
import { simulate } from "@site/lib/simulator/simulate";
import type { AlgorithmId, DecisionSample, SimulationResult } from "@site/lib/simulator/types";
import { activeBrand } from "@site/brand/presets";
import { chartPalette } from "@site/brand/types";
import { ui } from "@site/components/ui";
import { MetricLine, TrafficChart, type ChartPalette } from "./charts";
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

/** Defaults to the active brand's chart palette and product name. */
export function Simulator({ palette = chartPalette(activeBrand()), product = activeBrand().identity.product }: { palette?: ChartPalette; product?: string }) {
  const [sourceId, setSourceId] = useState("hightouch");
  const [senderId, setSenderId] = useState("braze");
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
  const select = `rounded-brand-sm ${ui.border} bg-surface px-2 py-1.5 text-sm`;

  if (result instanceof Error) {
    return <p role="alert" className="text-sm text-bad">The simulator hit an error. Reload the page to try again.</p>;
  }
  const started = playback.day >= 1;
  const finished = playback.day >= preset.days;
  const visible = result.days.slice(0, Math.max(1, playback.day));
  const today = visible.at(-1)!;
  const chartDays = started ? visible : [];

  return (
    <div className={`space-y-6 ${ui.panel} p-4 sm:p-6`}>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-ink-3">Data source
          <select className={select} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">Sender
          <select className={select} value={senderId} onChange={(e) => setSenderId(e.target.value)}>
            {senders().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">Use case
          <select className={select} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">Algorithm
          <select className={select} value={algorithm} onChange={(e) => setAlgorithm(e.target.value as AlgorithmId)}>
            {ALGORITHMS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>

      <FlowDiagram source={source.name} sender={sender.name} active={playback.playing} product={product} />
      <div className="space-y-1">
        <p className="text-sm text-ink-3">{preset.description} {ALGORITHMS.find((a) => a.id === algorithm)!.blurb}</p>
        {(algorithm === "thompson" || algorithm === "epsilon") && (
          <p className="text-xs text-ink-3">{GLOBAL_WINNER_NOTE}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {playback.playing
          ? <button className={ui.btnPrimary} onClick={playback.pause}>Pause</button>
          : <button className={ui.btnPrimary} onClick={playback.play}>{finished ? "Replay" : playback.day === 0 ? "Run" : "Resume"}</button>}
        <button className={ui.btnSecondarySm} onClick={playback.reset}>Reset</button>
        {!finished && (
          <button className={ui.btnSecondarySm} onClick={() => { playback.reset(); playback.play(); }}>Replay</button>
        )}
        <button className={ui.btnSecondarySm} onClick={() => setSeed((s) => s + 1)}>New audience</button>
        <span className="ml-auto flex gap-1 text-xs">
          {([1, 2, 4] as Speed[]).map((s) => (
            <button key={s} aria-pressed={playback.speed === s} onClick={() => playback.setSpeed(s)}
              className={`rounded-brand-sm px-2 py-1 ${playback.speed === s ? ui.toggleOn : ui.toggleOff}`}>{s}×</button>
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
        <TrafficChart days={chartDays} variants={preset.variants} palette={palette} />
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <section><h4 className="mb-2 text-sm font-semibold">Lift vs. control</h4>
          <MetricLine days={chartDays} dataKey="liftVsHoldout" label="Lift" format={(v) => `${Math.round(v * 100)}%`} palette={palette} /></section>
        <section><h4 className="mb-2 text-sm font-semibold">Regret (conversions lost vs. always picking the best)</h4>
          <MetricLine days={chartDays} dataKey="cumulativeRegret" label="Regret" format={(v) => v.toFixed(0)} palette={palette} /></section>
      </div>

      {started && preset.segments.length > 1 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold">What each segment is getting today</h4>
          <ul className="grid gap-2 sm:grid-cols-3 text-sm">
            {preset.segments.map((s) => {
              const v = preset.variants.find((x) => x.id === today.topVariantBySegment[s.id])!;
              return <li key={s.id} className={`rounded-brand-sm ${ui.border} p-2`}><span className="text-ink-3">{s.label}:</span> {v.id} · {v.label}</li>;
            })}
          </ul>
        </section>
      )}

      <section aria-live="polite">
        <h4 className="mb-2 text-sm font-semibold">Why this decision?</h4>
        {!started && <p className="text-xs text-ink-3">Press Run to start</p>}
        <ul className="space-y-1 font-mono text-xs text-ink-3">
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
              <tr key={v.id}><td>{v.id} · {v.label}: <span className="text-ink-3">“{v.copy}”</span></td>
                {v.rates.map((r, i) => <td key={i}>{(r * 100).toFixed(1)}%</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-3">Simulated data. The algorithms are Nexus&apos;s production engine, running in your browser.</p>
      </details>
    </div>
  );
}

function Stat({ label, value, good, note }: { label: string; value: string; good?: boolean; note?: string }) {
  return (
    <div className={`${ui.box} p-3`}>
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`text-2xl font-semibold ${good ? "text-ok" : ""}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}
