import { COPY } from "@site/content/copy";
import { LeadForm } from "@site/components/lead-form";
export function Offer() {
  return (
    <section id="design-partner" className="scroll-mt-8 rounded-2xl border border-[var(--accent)]/40 bg-[var(--panel)] p-6 sm:p-10">
      <h2 className="text-3xl font-bold">{COPY.offer.title}</h2>
      <p className="mt-3 text-lg">{COPY.offer.terms}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">{COPY.offer.after}</p>
      <div className="mt-8"><LeadForm /></div>
    </section>
  );
}
