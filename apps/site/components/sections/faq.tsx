import { COPY } from "@site/content/copy";
export function Faq() {
  return (
    <section className="py-16">
      <h2 className="text-2xl font-bold">FAQ</h2>
      <dl className="mt-6 space-y-5">{COPY.faq.map((f) => <div key={f.q}><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-[var(--muted)]">{f.a}</dd></div>)}</dl>
      <footer className="mt-16 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">© {new Date().getFullYear()} Beacon Frontier</footer>
    </section>
  );
}
