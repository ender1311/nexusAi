import { connectorLabel, contentSources, senders, sources } from "@site/content/connectors";
export function StackStrip() {
  const pill = "rounded-full border border-[var(--border)] px-3 py-1 text-sm";
  return (
    <section className="grid gap-6 border-y border-[var(--border)] py-8 sm:grid-cols-3">
      <div><h2 className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">Connect from</h2>
        <ul className="flex flex-wrap gap-2">{sources().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
      <div><h2 className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">Send through</h2>
        <ul className="flex flex-wrap gap-2">{senders().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
      <div><h2 className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">Content from</h2>
        <ul className="flex flex-wrap gap-2">{contentSources().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
    </section>
  );
}
