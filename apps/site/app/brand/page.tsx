import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allBrandsCss } from "@site/brand/css";
import { BrandLogo } from "@site/brand/logos";
import { previewFontVariables } from "@site/brand/preview-fonts.generated";
import { BRANDS } from "@site/brand/presets";
import { chartThemes } from "@site/brand/chart-theme";
import type { BrandPreset } from "@site/brand/types";
import { CodeBlock } from "@site/components/demo/code-block";
import { ui } from "@site/components/ui";
import { COPY } from "@site/content/copy";
import { getPreset } from "@site/lib/simulator/presets";
import { simulate } from "@site/lib/simulator/simulate";
import { SampleChart } from "./sample-chart";

export const metadata: Metadata = {
  title: "Brand presets",
  robots: { index: false, follow: false },
};

const SAMPLE_DAYS = simulate(getPreset("winback"), "thompson", 1).days;
const RAIL = ["1 Hightouch", "2 Features", "3 Content", "4 Decide", "5 Braze", "6 Learn"];

function BrandSample({ brand }: { brand: BrandPreset }) {
  return (
    <div data-brand={brand.id} className={`bg-bg font-sans text-ink ${ui.border} rounded-brand-lg p-6`}>
      <p className={`flex items-center gap-2 ${ui.eyebrow}`}><BrandLogo logo={brand.identity.logo} />{brand.identity.eyebrow}</p>
      <p className={`mt-1 ${ui.label} text-ink-3`}>{brand.label} · {brand.id} · {brand.colorScheme} · {brand.density}</p>
      <h2 className={`mt-4 text-3xl ${ui.display}`}>{COPY.hero.title}</h2>

      <div className="mt-6 flex flex-wrap gap-3">
        <span className={ui.btnPrimary}>{COPY.hero.primary}</span>
        <span className={`${ui.btnSecondary} ${ui.btnText}`}>{COPY.hero.secondary}</span>
      </div>

      <ul className="mt-6 flex flex-wrap gap-2">
        {["Hightouch", "Braze", "Segment (roadmap)"].map((p) => <li key={p} className={`${ui.pill} px-3 py-1 text-sm`}>{p}</li>)}
      </ul>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className={`${ui.panel} p-5`}>
          <span className="text-sm text-accent-ink">1</span>
          <h3 className="mt-1 font-semibold">{COPY.how[0]!.title}</h3>
          <p className="mt-2 text-sm text-ink-3">{COPY.how[0]!.body}</p>
        </div>
        <div className={`${ui.box} p-3`}>
          <div className="text-xs text-ink-3">Lift vs. 10% random-split control</div>
          <div className="text-2xl font-semibold text-ok">+18%</div>
          <SampleChart days={SAMPLE_DAYS} themes={chartThemes(brand)} />
        </div>
      </div>

      <div role="group" className="mt-6 grid gap-3 sm:grid-cols-2" aria-label={`${brand.label} sample form`}>
        <label className="flex flex-col gap-1 text-sm">Work email<input name="email" type="email" className={ui.field} placeholder="you@company.com" /></label>
        <label className="flex flex-col gap-1 text-sm">Sender<select name="sender" className={ui.field} defaultValue="braze"><option value="braze">Braze</option></select></label>
      </div>

      <ol className="mt-6 flex flex-wrap gap-2">
        {RAIL.map((label, i) => (
          <li key={label} className={`rounded-brand-sm px-3 py-1 text-sm ${i === 4 ? ui.toggleOn : ui.toggleOff}`}>{label}</li>
        ))}
      </ol>
      <div className="mt-4"><CodeBlock label="Sample: request body" data={{ trigger_properties: { nexus_variant: "B", score: 0.42 } }} /></div>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <span className={`${ui.box} bg-ok-bg px-3 py-2 text-ok`}>Sent to Braze</span>
        <span className={`${ui.box} bg-bad-bg px-3 py-2 text-bad`}>Something went wrong. Please try again.</span>
      </div>
    </div>
  );
}

/** /nexus/brand: every preset side by side. Never served in production. */
export default function BrandPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <main className={`mx-auto max-w-7xl px-4 py-12 ${previewFontVariables}`}>
      {/* Every preset's tokens, so each sample can opt in with data-brand. The layout only ships the active one. */}
      <style dangerouslySetInnerHTML={{ __html: allBrandsCss() }} />
      <h1 className={`text-3xl ${ui.display}`}>Brand presets</h1>
      <p className="mt-2 text-ink-3">Set NEXT_PUBLIC_BRAND to one of these ids and redeploy. See apps/site/brand/README.md.</p>
      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        {Object.values(BRANDS).map((brand) => <BrandSample key={brand.id} brand={brand} />)}
      </div>
    </main>
  );
}
