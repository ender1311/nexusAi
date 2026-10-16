import { COPY } from "@site/content/copy";
import { ui } from "@site/components/ui";

export function Faq() {
  return (
    <section data-section="faq" className={ui.section}>
      <h2 className={`text-2xl ${ui.display}`}>FAQ</h2>
      <dl className="mt-6 space-y-5">{COPY.faq.map((f) => <div key={f.q}><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-ink-3">{f.a}</dd></div>)}</dl>
    </section>
  );
}
