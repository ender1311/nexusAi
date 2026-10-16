export function CodeBlock({ data, label }: { data: unknown; label?: string }) {
  return (
    <figure className="min-w-0 space-y-1">
      {label ? <figcaption className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</figcaption> : null}
      <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed">
        <code>{JSON.stringify(data, null, 2)}</code>
      </pre>
    </figure>
  );
}
