export function FlowDiagram({ source, sender, active }: { source: string; sender: string; active: boolean }) {
  const node = "rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium";
  const pipe = `h-0.5 flex-1 bg-gradient-to-r from-[var(--accent)]/20 via-[var(--accent)] to-[var(--accent)]/20 ${active ? "animate-pulse" : "opacity-40"}`;
  return (
    <div className="flex items-center gap-2" aria-label={`${source} to Nexus to ${sender}`}>
      <span className={node}>{source}</span>
      <span className={pipe} />
      <span className={`${node} text-[var(--accent)]`}>Nexus</span>
      <span className={pipe} />
      <span className={node}>{sender}</span>
    </div>
  );
}
