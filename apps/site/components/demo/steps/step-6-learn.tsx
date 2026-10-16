import { armEstimate, type ArmStats } from "@site/lib/demo/build-step-data";

type Props = { stats: ArmStats; onOutcome: (converted: boolean) => void; onReset: () => void };

export function Step6Learn({ stats, onOutcome, onReset }: Props) {
  const mean = armEstimate(stats);
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Every outcome Braze reports updates the arm&apos;s belief. A conversion raises alpha, a miss raises beta, and the next decision uses the new numbers.
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Sample: arm statistics</p>
      <dl className="grid max-w-sm grid-cols-3 gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-center">
        <div><dt className="text-xs text-[var(--muted)]">Alpha (wins)</dt><dd className="text-2xl font-semibold tabular-nums text-[var(--good)]" data-testid="arm-alpha">{stats.alpha}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Beta (misses)</dt><dd className="text-2xl font-semibold tabular-nums text-[var(--bad)]" data-testid="arm-beta">{stats.beta}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Estimate</dt><dd className="text-2xl font-semibold tabular-nums">{(mean * 100).toFixed(1)}%</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={() => onOutcome(true)}>User converted</button>
        <button className="rounded-md border border-[var(--border)] px-4 py-2 text-sm" onClick={() => onOutcome(false)}>No conversion</button>
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={onReset}>Reset</button>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <a href="/nexus#design-partner" className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">Become a design partner</a>
        <a href="/nexus#simulator" className="rounded-md border border-[var(--border)] px-4 py-2 text-sm">Back to the simulator</a>
      </div>
    </div>
  );
}
