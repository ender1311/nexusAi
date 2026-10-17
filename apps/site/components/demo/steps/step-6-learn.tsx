import { armEstimate, type ArmStats } from "@site/lib/demo/build-step-data";
import { ui } from "@site/components/ui";

type Props = { stats: ArmStats; onOutcome: (converted: boolean) => void; onReset: () => void };

export function Step6Learn({ stats, onOutcome, onReset }: Props) {
  const mean = armEstimate(stats);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">
        Every outcome Braze reports updates the arm&apos;s belief. A conversion raises alpha, a miss raises beta, and the next decision uses the new numbers.
      </p>
      <p className={`${ui.label} font-semibold text-ink-3`}>Sample: arm statistics</p>
      <dl className={`grid max-w-sm grid-cols-3 gap-3 ${ui.panel} p-4 text-center`}>
        <div><dt className="text-xs text-ink-3">Alpha (wins)</dt><dd className="text-2xl font-semibold tabular-nums text-ok" data-testid="arm-alpha">{stats.alpha}</dd></div>
        <div><dt className="text-xs text-ink-3">Beta (misses)</dt><dd className="text-2xl font-semibold tabular-nums text-bad" data-testid="arm-beta">{stats.beta}</dd></div>
        <div><dt className="text-xs text-ink-3">Estimate</dt><dd className="text-2xl font-semibold tabular-nums">{(mean * 100).toFixed(1)}%</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button className={ui.btnPrimary} onClick={() => onOutcome(true)}>User converted</button>
        <button className={ui.btnSecondary} onClick={() => onOutcome(false)}>No conversion</button>
        <button className={ui.btnSecondarySm} onClick={onReset}>Reset</button>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <a href="/nexus#design-partner" data-cta="demo-design-partner" className={ui.btnPrimary}>Become a design partner</a>
        <a href="/nexus#simulator" data-cta="demo-simulator" className={ui.btnSecondary}>Back to the simulator</a>
      </div>
    </div>
  );
}
