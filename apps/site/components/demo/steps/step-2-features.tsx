import { stepFeatures } from "@site/lib/demo/build-step-data";

export function Step2Features({ product }: { product: string }) {
  const { labelled, persona } = stepFeatures();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">
        {product} turns the user&apos;s history into a 10-number feature vector, then assigns the nearest persona.
      </p>
      <p className="text-sm">
        Persona: <span className="rounded-chip bg-accent px-3 py-1 text-xs font-semibold text-on-accent">{persona.label}</span>
      </p>
      <ul className="space-y-2">
        {labelled.map(({ label, value }) => (
          <li key={label} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-2 text-xs sm:grid-cols-[16rem_1fr_3rem]">
            <span className="text-ink-3">{label}</span>
            <span className="h-2 overflow-hidden rounded-brand-sm bg-line">
              <span className="block h-full bg-accent" style={{ width: `${Math.min(Math.max(value, 0), 1) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
