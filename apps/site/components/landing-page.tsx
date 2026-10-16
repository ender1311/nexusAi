import { Fragment, type ReactNode } from "react";
import type { BrandPreset, SectionId } from "@site/brand/types";
import { chartThemes } from "@site/brand/chart-theme";
import { Simulator } from "@site/components/simulator/simulator";
import { Comparison } from "@site/components/sections/comparison";
import { ConsoleLink } from "@site/components/sections/console-link";
import { Faq } from "@site/components/sections/faq";
import { Hero } from "@site/components/sections/hero";
import { HowItWorks } from "@site/components/sections/how-it-works";
import { Offer } from "@site/components/sections/offer";
import { StackStrip } from "@site/components/sections/stack-strip";
import { ui } from "@site/components/ui";
import { publicConfig } from "@site/lib/public-config";

function SimulatorSection({ brand }: { brand: BrandPreset }) {
  return (
    <section data-section="simulator" id="simulator" className={`scroll-mt-8 ${ui.section}`}>
      <h2 className={`text-3xl ${ui.display}`}>Watch it learn</h2>
      <p className="mt-2 mb-6 text-ink-3">Pick your stack and a use case, then press Run. This is the real {brand.identity.product} engine, running in your browser on simulated users.</p>
      <Simulator chartThemes={chartThemes(brand)} product={brand.identity.product} />
    </section>
  );
}

function renderSection(id: SectionId, brand: BrandPreset): ReactNode {
  switch (id) {
    case "hero": return <Hero brand={brand} />;
    case "stack": return <StackStrip />;
    case "simulator": return <SimulatorSection brand={brand} />;
    case "how": return <HowItWorks />;
    case "comparison": return <Comparison product={brand.identity.product} />;
    case "offer": return <Offer />;
    case "faq": return <Faq />;
  }
}

/** The landing page for a brand: its sections, in its order. */
export function LandingPage({ brand }: { brand: BrandPreset }) {
  return (
    <main className="mx-auto max-w-5xl px-4">
      {brand.layout.sections.map((id) => (
        <Fragment key={id}>
          {renderSection(id, brand)}
          {id === "offer" && publicConfig.showConsoleLink ? <ConsoleLink /> : null}
        </Fragment>
      ))}
      <footer className={`${ui.borderT} pt-6 pb-[var(--section-y)] text-xs text-ink-3`}>© {new Date().getFullYear()} {brand.identity.name}</footer>
    </main>
  );
}
