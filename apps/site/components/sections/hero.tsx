import { COPY } from "@site/content/copy";
import { BrandLogo } from "@site/brand/logos";
import type { BrandPreset } from "@site/brand/types";
import { ui } from "@site/components/ui";

export function Hero({ brand }: { brand: BrandPreset }) {
  const centered = brand.layout.hero === "centered";
  return (
    <section data-section="hero" data-hero={brand.layout.hero}
      className={`py-[var(--section-y)] sm:py-[calc(var(--section-y)*1.5)] ${centered ? "flex flex-col items-center text-center" : ""}`}>
      <p className={`mb-4 flex items-center gap-2 ${ui.eyebrow}`}>
        <BrandLogo logo={brand.identity.logo} />
        {brand.identity.eyebrow}
      </p>
      <h1 className={`max-w-3xl text-4xl sm:text-6xl font-serif font-[number:var(--display-weight)] tracking-[calc(var(--display-tracking)-0.025em)]`}>{COPY.hero.title}</h1>
      <p className="mt-6 max-w-2xl text-lg text-ink-3">{COPY.hero.subtitle}</p>
      <div className={`mt-8 flex flex-wrap gap-3 ${centered ? "justify-center" : ""}`}>
        <a href="#simulator" className={`rounded-brand-sm bg-accent px-[calc(var(--control-x)*1.25)] py-[calc(var(--control-y)*1.5)] text-on-accent ${ui.btnText}`}>{COPY.hero.primary}</a>
        <a href="#design-partner" className={`rounded-brand-sm ${ui.border} px-[calc(var(--control-x)*1.25)] py-[calc(var(--control-y)*1.5)] ${ui.btnText}`}>{COPY.hero.secondary}</a>
      </div>
      <p className="mt-6 text-sm text-ink-3">{COPY.hero.proof}</p>
    </section>
  );
}
