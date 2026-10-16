import { COPY } from "@site/content/copy";
export function HowItWorks() {
  return (
    <section className="py-16">
      <h2 className="text-3xl font-bold">How it works</h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {COPY.how.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
            <span className="text-sm text-[var(--accent)]">{i + 1}</span>
            <h3 className="mt-1 font-semibold">{s.title}</h3><p className="mt-2 text-sm text-[var(--muted)]">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {COPY.algorithms.map((a) => <div key={a.name}><h3 className="font-semibold">{a.name}</h3><p className="text-sm text-[var(--muted)]">{a.body}</p></div>)}
      </div>
      <p className="mt-6 text-sm">{COPY.provenance}</p>
      <p className="mt-4"><a href="/nexus/demo" className="text-sm font-semibold text-[var(--accent)]">See the full loop step by step &rarr;</a></p>
    </section>
  );
}
