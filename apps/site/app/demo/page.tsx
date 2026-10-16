import type { Metadata } from "next";
import { Walkthrough } from "@site/components/demo/walkthrough";
import { parseDemoParams } from "@site/lib/demo/url-state";

export const metadata: Metadata = {
  title: "Nexus demo: the full loop, step by step",
  description: "Follow one user from Hightouch through Nexus and your content source to Braze, and watch the agent learn. Sample data, real Nexus code.",
  alternates: { canonical: "/nexus/demo" },
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const { step, source } = parseDemoParams(sp);
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <a href="/nexus" className="text-sm text-[var(--muted)]">← Nexus</a>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">The full loop, step by step</h1>
      <p className="mt-2 text-[var(--muted)]">One Lumen user, from Hightouch to Braze and back. The data is sample data; the decisions and payloads come from Nexus&apos;s real code.</p>
      <div className="mt-8"><Walkthrough initialStep={step} initialSource={source} /></div>
    </main>
  );
}
