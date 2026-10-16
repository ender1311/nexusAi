import { COPY } from "@site/content/copy";
import { LeadForm } from "@site/components/lead-form";
import { ui } from "@site/components/ui";

export function Offer() {
  return (
    <section data-section="offer" id="design-partner"
      className="scroll-mt-8 rounded-brand-lg border-[length:var(--border-width)] border-accent/40 bg-surface p-6 shadow-brand-pop sm:p-10">
      <h2 className={`text-3xl ${ui.display}`}>{COPY.offer.title}</h2>
      <p className="mt-3 text-lg">{COPY.offer.terms}</p>
      <p className="mt-2 text-sm text-ink-3">{COPY.offer.after}</p>
      <div className="mt-8"><LeadForm /></div>
    </section>
  );
}
