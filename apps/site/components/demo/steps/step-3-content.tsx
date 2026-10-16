import { CodeBlock } from "../code-block";
import { stepContent } from "@site/lib/demo/build-step-data";
import type { DemoSource } from "@site/content/demo-lumen";
import { ui } from "@site/components/ui";

export function Step3Content({ source }: { source: DemoSource }) {
  const { sourceRecord, mapping, item } = stepContent(source);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">
        Your content stays where it lives. A field mapping reads each record into the one shape Nexus decides over.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <CodeBlock label="Sample: source record" data={sourceRecord} />
        <div className="min-w-0 space-y-1">
          <p className={`${ui.label} font-semibold text-ink-3`}>Mapping</p>
          {mapping ? (
            <table className="w-full text-left text-xs">
              <thead><tr className="text-ink-3"><th className="py-1 pr-2 font-medium">Field</th><th className="py-1 font-medium">Path</th></tr></thead>
              <tbody>
                {Object.entries(mapping).map(([field, path]) => (
                  <tr key={field} className={ui.borderT}><td className="py-1 pr-2">{field}</td><td className="break-all py-1 font-mono">{path}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-ink-3">No mapping needed: library items are already in the Nexus shape.</p>
          )}
        </div>
        <CodeBlock label="Resulting content item" data={item} />
      </div>
    </div>
  );
}
