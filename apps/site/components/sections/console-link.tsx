import { COPY } from "@site/content/copy";
import { publicConfig } from "@site/lib/public-config";
export function ConsoleLink() {
  return (
    <section className="py-16">
      <h2 className="text-2xl font-bold">{COPY.console.title}</h2>
      <p className="mt-2 text-[var(--muted)]">{COPY.console.body}</p>
      <a href={publicConfig.consoleUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block rounded-md border border-[var(--border)] px-4 py-2 font-semibold">{COPY.console.cta} ↗</a>
    </section>
  );
}
