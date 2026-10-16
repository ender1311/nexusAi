import { COPY } from "@site/content/copy";
import { ui } from "@site/components/ui";

export function HowItWorks() {
  return (
    <section data-section="how" className={ui.section}>
      <h2 className={`text-3xl ${ui.display}`}>How it works</h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {COPY.how.map((s, i) => (
          <li key={s.title} className={`${ui.panel} p-5`}>
            <span className="text-sm text-accent-ink">{i + 1}</span>
            <h3 className="mt-1 font-semibold">{s.title}</h3><p className="mt-2 text-sm text-ink-3">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {COPY.algorithms.map((a) => <div key={a.name}><h3 className="font-semibold">{a.name}</h3><p className="text-sm text-ink-3">{a.body}</p></div>)}
      </div>
      <p className="mt-6 text-sm">{COPY.provenance}</p>
      <p className="mt-4"><a href="/nexus/demo" className="text-sm font-semibold text-accent-ink">See the full loop step by step &rarr;</a></p>
    </section>
  );
}
