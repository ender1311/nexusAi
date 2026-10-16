import { connectorLabel, contentSources, senders, sources } from "@site/content/connectors";
import { ui } from "@site/components/ui";

export function StackStrip() {
  const pill = `${ui.pill} px-3 py-1 text-sm`;
  const heading = `mb-3 ${ui.label} text-ink-3`;
  return (
    <section data-section="stack" className={`grid gap-6 ${ui.borderY} py-[calc(var(--section-y)/2)] sm:grid-cols-2 lg:grid-cols-3`}>
      <div><h2 className={heading}>Connect from</h2>
        <ul className="flex flex-wrap gap-2">{sources().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
      <div><h2 className={heading}>Send through</h2>
        <ul className="flex flex-wrap gap-2">{senders().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
      <div><h2 className={heading}>Content from</h2>
        <ul className="flex flex-wrap gap-2">{contentSources().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
    </section>
  );
}
