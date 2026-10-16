import { COPY } from "@site/content/copy";
import { ui } from "@site/components/ui";

export function Comparison({ product }: { product: string }) {
  const c = COPY.comparison;
  return (
    <section data-section="comparison" className={ui.section}>
      <h2 className={`text-3xl ${ui.display}`}>{c.title}</h2>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead><tr className={ui.borderB}><th className="py-2" /><th className="py-2 text-accent-ink">{product}</th><th className="py-2 text-ink-3">ESP add-ons</th></tr></thead>
          <tbody>{c.rows.map((r) => <tr key={r.label} className={ui.borderB}><td className="py-2 font-medium">{r.label}</td><td>{r.nexus}</td><td className="text-ink-3">{r.them}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-3">{c.footnote}</p>
    </section>
  );
}
