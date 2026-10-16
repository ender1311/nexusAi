import { stepDecideCaption, stepFeatures, type stepDecide } from "@site/lib/demo/build-step-data";

export function Step4Decide({ decision, onPickAgain }: { decision: ReturnType<typeof stepDecide>; onPickAgain: () => void }) {
  const { chosen, arms } = decision;
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Thompson sampling draws once from each arm&apos;s belief and picks the highest, so strong arms win most often while uncertain ones still get tested.
      </p>
      <p className="text-xs text-[var(--muted)]">{stepDecideCaption(stepFeatures().persona.label)}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs text-[var(--muted)]"><th className="py-1 pr-2 font-medium">Message</th><th className="py-1 font-medium">Sample estimate</th></tr></thead>
          <tbody>
            {arms.map(({ item, estimate, uncertainty }) => {
              const isChosen = item.externalRef === chosen.externalRef;
              return (
                <tr key={item.externalRef} aria-current={isChosen ? "true" : undefined}
                  className={`border-t border-[var(--border)] ${isChosen ? "bg-[var(--accent)]/15 font-semibold" : ""}`}>
                  <td className="py-2 pr-2">{item.title ?? item.body}{isChosen ? <span className="ml-2 text-xs text-[var(--good)]">Chosen</span> : null}</td>
                  <td className="py-2 tabular-nums">{(estimate * 100).toFixed(1)}% ± {(uncertainty * 100).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={onPickAgain}>Pick again</button>
    </div>
  );
}
