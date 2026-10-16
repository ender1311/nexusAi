import { CodeBlock } from "../code-block";
import { stepIngest } from "@site/lib/demo/build-step-data";

export function Step1Ingest() {
  const { warehouseRow, hightouchRecord, ingestRequest } = stepIngest();
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Your warehouse already knows your users. Hightouch syncs each row to Nexus as a user record, with no new tracking to build.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <CodeBlock label="Sample" data={warehouseRow} />
        <CodeBlock label="Sample: Hightouch record" data={hightouchRecord} />
        <CodeBlock label="Sample: ingest request" data={ingestRequest} />
      </div>
    </div>
  );
}
