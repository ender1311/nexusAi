import { ui } from "@site/components/ui";

export function FlowDiagram({ source, sender, active, product }: { source: string; sender: string; active: boolean; product: string }) {
  const node = `${ui.box} bg-surface px-3 py-2 text-sm font-medium`;
  const pipe = `h-0.5 flex-1 bg-gradient-to-r from-accent/20 via-accent to-accent/20 ${active ? "animate-pulse" : "opacity-40"}`;
  return (
    <div className="flex items-center gap-2" aria-label={`${source} to ${product} to ${sender}`}>
      <span className={node}>{source}</span>
      <span className={pipe} />
      <span className={`${node} text-accent-ink`}>{product}</span>
      <span className={pipe} />
      <span className={node}>{sender}</span>
    </div>
  );
}
