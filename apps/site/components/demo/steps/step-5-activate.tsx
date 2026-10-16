import { useState } from "react";
import { CodeBlock } from "../code-block";
import { stepActivate } from "@site/lib/demo/build-step-data";
import { contentSources } from "@site/content/connectors";
import type { DemoSource } from "@site/content/demo-lumen";
import { ui } from "@site/components/ui";

type Channel = "content_card" | "push";
const CHANNELS: { id: Channel; label: string }[] = [
  { id: "content_card", label: "Content card" },
  { id: "push", label: "Push" },
];

export function Step5Activate({ source, chosenRef, product }: { source: DemoSource; chosenRef: string; product: string }) {
  const [channel, setChannel] = useState<Channel>("content_card");
  const { mode, endpoint, body, liquid } = stepActivate(source, channel, chosenRef);
  const catalogRoadmap = contentSources().find((c) => c.id === "braze-catalog")?.status === "roadmap";
  const pushCannotReadCatalog = source === "braze-catalog" && channel === "push";
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">
        {mode === "reference" ? `With the Braze Catalog connector${catalogRoadmap ? " (roadmap)" : ""}, Braze renders the catalog item ${product} picked. ` : ""}{product} sends one API call; Braze does the delivery.
      </p>
      {pushCannotReadCatalog ? (
        <p className="text-xs text-ink-3">Push goes through /messages/send, which can&apos;t read a catalog, so the copy is sent inline.</p>
      ) : null}
      <div className="flex gap-2" role="group" aria-label="Channel">
        {CHANNELS.map((c) => (
          <button key={c.id} aria-pressed={channel === c.id} onClick={() => setChannel(c.id)}
            className={`rounded-brand-sm px-3 py-1 text-sm ${channel === c.id ? ui.toggleOn : ui.toggleOff}`}>{c.label}</button>
        ))}
      </div>
      <p className="break-all text-xs">POST <code className="font-mono">{endpoint}</code></p>
      <CodeBlock label="Sample: request body" data={body} />
      {liquid ? (
        <figure className="min-w-0 space-y-1">
          <figcaption className={`${ui.label} font-semibold text-ink-3`}>Sample: Liquid in the Braze template</figcaption>
          <pre className={`overflow-x-auto ${ui.box} bg-surface p-3 font-mono text-xs`}><code>{liquid}</code></pre>
        </figure>
      ) : null}
    </div>
  );
}
