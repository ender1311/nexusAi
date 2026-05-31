"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type PerLang = { language: string; action: "create" | "update" | "noop" };
type Matched = { stem: string; variantName: string; languages: PerLang[]; englishDivergence: { incoming: string; current: string } | null };
type Unmatched = { stem: string; languages: string[] };
type Plan = { matched: Matched[]; unmatched: Unmatched[]; totals: { stems: number; matchedStems: number; unmatchedStems: number; creates: number; updates: number; noops: number } };
type ImportResponse = { data: { plan: Plan; skipped: { relativePath: string; reason: string }[]; committed?: { created: number; updated: number; englishRefreshed: number } } };

export function PushTranslationUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [committed, setCommitted] = useState<ImportResponse["data"]["committed"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(commit: boolean) {
    if (!files || files.length === 0) { setError("Pick a folder first."); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      if (commit) fd.append("commit", "true");
      const res = await fetch("/api/push-translations/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Upload failed"); return; }
      const data = (json as ImportResponse).data;
      setPlan(data.plan);
      setCommitted(data.committed ?? null);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">Upload translations</h3>
        <p className="text-sm text-muted-foreground">Pick a push folder (e.g. <code>push1/</code>) or a parent folder of pushes. We match each file to its English push and show a plan before saving.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error non-standard but widely supported directory upload attrs
          webkitdirectory=""
          directory=""
          multiple
          onChange={(e) => { setFiles(e.target.files); setPlan(null); setCommitted(null); setError(null); }}
          className="block text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={() => send(false)} disabled={busy || !files} variant="outline">
            {busy ? "Analyzing…" : "Preview plan"}
          </Button>
          <Button onClick={() => send(true)} disabled={busy || !plan || plan.totals.matchedStems === 0}>
            {busy ? "Saving…" : `Commit ${plan ? plan.totals.creates + plan.totals.updates : 0} translations`}
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {committed && (
          <p className="text-sm text-emerald-600">
            Saved: {committed.created} created, {committed.updated} updated{committed.englishRefreshed ? `, ${committed.englishRefreshed} English refreshed` : ""}.
          </p>
        )}

        {plan && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">
              {plan.totals.matchedStems} matched · {plan.totals.unmatchedStems} unmatched ·
              {" "}{plan.totals.creates} new · {plan.totals.updates} updates
            </p>
            {plan.matched.map((m) => (
              <div key={m.stem} className="rounded border border-border p-2">
                <p className="font-medium">{m.variantName}</p>
                <p className="text-muted-foreground">
                  {m.languages.map((l) => `${l.language} (${l.action})`).join(", ") || "no non-English languages"}
                </p>
                {m.englishDivergence && (
                  <p className="text-amber-600">⚠ English differs from the stored variant (not overwritten).</p>
                )}
              </div>
            ))}
            {plan.unmatched.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/20">
                <p className="font-medium text-amber-700 dark:text-amber-400">Unmatched pushes (skipped)</p>
                <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">
                  {plan.unmatched.map((u) => <li key={u.stem}>{u.stem} — {u.languages.join(", ")}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
