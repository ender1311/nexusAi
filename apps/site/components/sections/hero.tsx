import { COPY } from "@site/content/copy";
export function Hero() {
  return (
    <section className="py-16 sm:py-24">
      <p className="mb-4 text-sm font-medium text-[var(--accent)]">Nexus by Beacon Frontier</p>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">{COPY.hero.title}</h1>
      <p className="mt-6 max-w-2xl text-lg text-[var(--muted)]">{COPY.hero.subtitle}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="#simulator" className="rounded-md bg-[var(--accent)] px-5 py-3 font-semibold text-white">{COPY.hero.primary}</a>
        <a href="#design-partner" className="rounded-md border border-[var(--border)] px-5 py-3 font-semibold">{COPY.hero.secondary}</a>
      </div>
      <p className="mt-6 text-sm text-[var(--muted)]">{COPY.hero.proof}</p>
    </section>
  );
}
