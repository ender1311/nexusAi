import { Simulator } from "@site/components/simulator/simulator";
import { Comparison } from "@site/components/sections/comparison";
import { ConsoleLink } from "@site/components/sections/console-link";
import { Faq } from "@site/components/sections/faq";
import { Hero } from "@site/components/sections/hero";
import { HowItWorks } from "@site/components/sections/how-it-works";
import { Offer } from "@site/components/sections/offer";
import { StackStrip } from "@site/components/sections/stack-strip";
import { publicConfig } from "@site/lib/public-config";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4">
      <Hero />
      <StackStrip />
      <section id="simulator" className="scroll-mt-8 py-16">
        <h2 className="text-3xl font-bold">Watch it learn</h2>
        <p className="mt-2 mb-6 text-[var(--muted)]">Pick your stack and a use case, then press Run. This is the real Nexus engine, running in your browser on simulated users.</p>
        <Simulator />
      </section>
      <HowItWorks />
      <Comparison />
      <Offer />
      {publicConfig.showConsoleLink && <ConsoleLink />}
      <Faq />
    </main>
  );
}
