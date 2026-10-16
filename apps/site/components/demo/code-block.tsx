import { ui } from "@site/components/ui";

export function CodeBlock({ data, label }: { data: unknown; label?: string }) {
  return (
    <figure className="min-w-0 space-y-1">
      {label ? <figcaption className={`${ui.label} font-semibold text-ink-3`}>{label}</figcaption> : null}
      <pre className={`overflow-x-auto ${ui.box} bg-surface p-3 font-mono text-xs leading-relaxed`}>
        <code>{JSON.stringify(data, null, 2)}</code>
      </pre>
    </figure>
  );
}
