import { COPY } from "@site/content/copy";
export function Comparison() {
  const c = COPY.comparison;
  return (
    <section className="py-16">
      <h2 className="text-3xl font-bold">{c.title}</h2>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead><tr className="border-b border-[var(--border)]"><th className="py-2" /><th className="py-2 text-[var(--accent)]">Nexus</th><th className="py-2 text-[var(--muted)]">ESP add-ons</th></tr></thead>
          <tbody>{c.rows.map((r) => <tr key={r.label} className="border-b border-[var(--border)]"><td className="py-2 font-medium">{r.label}</td><td>{r.nexus}</td><td className="text-[var(--muted)]">{r.them}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">{c.footnote}</p>
    </section>
  );
}
