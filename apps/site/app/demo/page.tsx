import type { Metadata } from "next";
import { activeBrand } from "@site/brand/presets";
import { Walkthrough } from "@site/components/demo/walkthrough";
import { ui } from "@site/components/ui";
import { parseDemoParams } from "@site/lib/demo/url-state";

const { product } = activeBrand().identity;

export const metadata: Metadata = {
  title: `${product} demo: the full loop, step by step`,
  description: `Follow one user from Hightouch through ${product} and your content source to Braze, and watch the agent learn. Sample data, real ${product} code.`,
  alternates: { canonical: "/nexus/demo" },
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const { step, source } = parseDemoParams(sp);
  return (
    <main className="mx-auto max-w-5xl px-4 py-[calc(var(--section-y)*0.75)]">
      <a href="/nexus" className="text-sm text-ink-3">← {product}</a>
      <h1 className={`mt-4 text-3xl sm:text-4xl ${ui.display}`}>The full loop, step by step</h1>
      <p className="mt-2 text-ink-3">One Lumen user, from Hightouch to Braze and back. The data is sample data; the feature vector, the decision and the Braze trigger properties come from {product}&apos;s real code, and the other payloads follow the real API shapes.</p>
      <div className="mt-8"><Walkthrough initialStep={step} initialSource={source} product={product} /></div>
    </main>
  );
}
