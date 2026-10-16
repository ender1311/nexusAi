"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ContentSourceConfig } from "@/connectors/content/config";
import type { SyncRunRow, TokenPresence } from "@/connectors/content/page-data";
import {
  CHANNEL_OPTIONS, MAPPING_KEYS, buildSaveBody, defaultMappingFor, initialFormState,
  type ChannelOption, type ConfigurableSource, type FormState, type MappingState,
} from "@/lib/content-sources-form";

type Props = { initialConfig: ContentSourceConfig; tokens: TokenPresence; initialRuns: SyncRunRow[] };

type SampleItem = { externalRef: string; title?: string; body: string };
type TestOutcome = { ok: true; sample: SampleItem[] } | { ok: false; error: string };
type SyncOutcome = {
  status: string; reason?: string; created: number; updated: number; archived: number; skipped: number;
  errors: { externalRef: string; message: string }[];
};

const SOURCES: { id: ConfigurableSource; label: string; tokenKey: keyof TokenPresence; tokenEnv: string }[] = [
  { id: "contentful", label: "Contentful", tokenKey: "contentful", tokenEnv: "CONTENTFUL_DELIVERY_TOKEN" },
  { id: "sanity", label: "Sanity", tokenKey: "sanity", tokenEnv: "SANITY_READ_TOKEN" },
  { id: "generic-json", label: "Generic JSON", tokenKey: "genericJson", tokenEnv: "GENERIC_CONTENT_TOKEN" },
  { id: "braze-catalog", label: "Braze Catalog", tokenKey: "braze", tokenEnv: "BRAZE_API_KEY" },
];

const GENERIC_URL_HELP = "Must be public https; credentials in the URL are rejected — use GENERIC_CONTENT_TOKEN.";
const SANITY_QUERY_HELP = 'Must be an array query such as *[_type == "tip"]; Nexus appends the page slice.';

async function readEnvelope<T>(res: Response): Promise<{ data?: T; error?: string }> {
  try {
    return (await res.json()) as { data?: T; error?: string };
  } catch {
    return { error: `Request failed (${res.status})` };
  }
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[12rem] flex-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function ChannelSelect({ value, onChange }: { value: ChannelOption; onChange: (v: ChannelOption) => void }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as ChannelOption)}>
      <SelectTrigger className="w-full sm:w-44" aria-label="Channel"><SelectValue /></SelectTrigger>
      <SelectContent>
        {CHANNEL_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function MappingEditor({ source, mapping, onChange }: {
  source: ConfigurableSource; mapping: MappingState; onChange: (m: MappingState) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Field mapping (dot path in the source record)</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MAPPING_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <label className="w-20 shrink-0 text-xs text-muted-foreground" htmlFor={`${source}-map-${key}`}>{key}</label>
            <Input
              id={`${source}-map-${key}`}
              value={mapping[key] ?? ""}
              placeholder={defaultMappingFor(source, key)}
              onChange={(e) => onChange({ ...mapping, [key]: e.target.value })}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ContentSourcesForm({ initialConfig, tokens, initialRuns }: Props) {
  const [state, setState] = useState<FormState>(() => initialFormState(initialConfig));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestOutcome>>({});
  const [syncs, setSyncs] = useState<Record<string, SyncOutcome | { error: string }>>({});
  const router = useRouter();
  const [savedConfig, setSavedConfig] = useState<ContentSourceConfig>(initialConfig);

  const patch = <K extends keyof FormState>(key: K, value: Partial<FormState[K]>) =>
    setState((s) => ({ ...s, [key]: { ...(s[key] as object), ...(value as object) } as FormState[K] }));

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/content-sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSaveBody(state, savedConfig)),
      });
      const body = await readEnvelope<ContentSourceConfig>(res);
      if (!res.ok || !body.data) {
        setSaveError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      setSavedConfig(body.data);
      setSaved(true);
    } catch {
      setSaveError("Save failed — network error");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(id: ConfigurableSource) {
    setBusy(`test:${id}`);
    try {
      const res = await fetch(`/api/content/test/${id}`, { method: "POST" });
      const body = await readEnvelope<TestOutcome>(res);
      setTests((t) => ({ ...t, [id]: body.data ?? { ok: false, error: body.error ?? `Test failed (${res.status})` } }));
    } catch {
      setTests((t) => ({ ...t, [id]: { ok: false, error: "Test failed — network error" } }));
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(id: ConfigurableSource) {
    setBusy(`sync:${id}`);
    try {
      const res = await fetch(`/api/content/sync/${id}`, { method: "POST" });
      const body = await readEnvelope<SyncOutcome>(res);
      setSyncs((s) => ({ ...s, [id]: body.data ?? { error: body.error ?? `Sync failed (${res.status})` } }));
      router.refresh();
    } catch {
      setSyncs((s) => ({ ...s, [id]: { error: "Sync failed — network error" } }));
    } finally {
      setBusy(null);
    }
  }

  function renderFields(id: ConfigurableSource) {
    if (id === "contentful") {
      const c = state.contentful;
      return (
        <>
          <div className="flex flex-wrap gap-4">
            <Field label="Space ID"><Input value={c.spaceId} onChange={(e) => patch("contentful", { spaceId: e.target.value })} /></Field>
            <Field label="Environment"><Input value={c.environment} onChange={(e) => patch("contentful", { environment: e.target.value })} /></Field>
            <Field label="Content type"><Input value={c.contentType} onChange={(e) => patch("contentful", { contentType: e.target.value })} /></Field>
            <Field label="Channel"><ChannelSelect value={c.channel} onChange={(channel) => patch("contentful", { channel })} /></Field>
          </div>
          <MappingEditor source="contentful" mapping={c.mapping} onChange={(mapping) => patch("contentful", { mapping })} />
        </>
      );
    }
    if (id === "sanity") {
      const s = state.sanity;
      return (
        <>
          <div className="flex flex-wrap gap-4">
            <Field label="Project ID"><Input value={s.projectId} onChange={(e) => patch("sanity", { projectId: e.target.value })} /></Field>
            <Field label="Dataset"><Input value={s.dataset} onChange={(e) => patch("sanity", { dataset: e.target.value })} /></Field>
            <Field label="Channel"><ChannelSelect value={s.channel} onChange={(channel) => patch("sanity", { channel })} /></Field>
          </div>
          <Field label="GROQ query" help={SANITY_QUERY_HELP}>
            <Textarea value={s.query} onChange={(e) => patch("sanity", { query: e.target.value })} className="font-mono text-xs" />
          </Field>
          <MappingEditor source="sanity" mapping={s.mapping} onChange={(mapping) => patch("sanity", { mapping })} />
        </>
      );
    }
    if (id === "generic-json") {
      const g = state.genericJson;
      const setPagination = (p: Partial<typeof g.pagination>) => patch("genericJson", { pagination: { ...g.pagination, ...p } });
      return (
        <>
          <div className="flex flex-wrap gap-4">
            <Field label="URL" help={GENERIC_URL_HELP}><Input value={g.url} onChange={(e) => patch("genericJson", { url: e.target.value })} /></Field>
            <Field label="Items path"><Input value={g.itemsPath} onChange={(e) => patch("genericJson", { itemsPath: e.target.value })} /></Field>
            <Field label="Channel"><ChannelSelect value={g.channel} onChange={(channel) => patch("genericJson", { channel })} /></Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Field label="Pagination">
              <Select value={g.pagination.mode} onValueChange={(v) => v && setPagination({ mode: v as typeof g.pagination.mode })}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Pagination mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="cursor">Cursor</SelectItem>
                  <SelectItem value="page">Page number</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {g.pagination.mode === "cursor" && (
              <>
                <Field label="Next cursor path"><Input value={g.pagination.nextPath} onChange={(e) => setPagination({ nextPath: e.target.value })} /></Field>
                <Field label="Cursor query param"><Input value={g.pagination.param} onChange={(e) => setPagination({ param: e.target.value })} /></Field>
              </>
            )}
            {g.pagination.mode === "page" && (
              <>
                <Field label="Page query param"><Input value={g.pagination.param} onChange={(e) => setPagination({ param: e.target.value })} /></Field>
                <Field label="Page size"><Input type="number" min="1" value={g.pagination.pageSize} onChange={(e) => setPagination({ pageSize: e.target.value })} /></Field>
              </>
            )}
          </div>
          <MappingEditor source="generic-json" mapping={g.mapping} onChange={(mapping) => patch("genericJson", { mapping })} />
        </>
      );
    }
    const b = state.brazeCatalog;
    return (
      <>
        <div className="flex flex-wrap gap-4">
          <Field label="Catalog name"><Input value={b.catalogName} onChange={(e) => patch("brazeCatalog", { catalogName: e.target.value })} /></Field>
          <Field label="Channel"><ChannelSelect value={b.channel} onChange={(channel) => patch("brazeCatalog", { channel })} /></Field>
        </div>
        <MappingEditor source="braze-catalog" mapping={b.mapping} onChange={(mapping) => patch("brazeCatalog", { mapping })} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">Nexus library</CardTitle>
            <Switch checked disabled aria-label="Enable Nexus library" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Copy authored in Nexus. Always on.</p>
        </CardContent>
      </Card>

      {SOURCES.map(({ id, label, tokenKey, tokenEnv }) => {
        const enabled = !!state.enabled[id];
        const test = tests[id];
        const sync = syncs[id];
        const tokenSet = tokens[tokenKey];
        return (
          <Card key={id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{label}</CardTitle>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => setState((s) => ({ ...s, enabled: { ...s.enabled, [id]: checked } }))}
                  aria-label={`Enable ${label}`}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {renderFields(id)}
              <p className={cn("text-xs", tokenSet ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
                {tokenSet ? "Token set ✓" : "Token not set ✗"} <span className="font-mono">({tokenEnv})</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => testConnection(id)}>
                  {busy === `test:${id}` ? "Testing…" : "Test connection"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !enabled} onClick={() => syncNow(id)}>
                  {busy === `sync:${id}` ? "Syncing…" : "Sync now"}
                </Button>
                <span className="text-xs text-muted-foreground">Test and sync use the saved config.</span>
              </div>
              {test && (
                <div className="rounded-lg border p-3 text-xs space-y-1" role="status">
                  {test.ok ? (
                    <>
                      <p className="font-semibold text-green-700 dark:text-green-400">ok</p>
                      {test.sample.slice(0, 3).map((item) => (
                        <p key={item.externalRef}><span className="font-medium">{item.title ?? item.externalRef}</span> — {item.body}</p>
                      ))}
                    </>
                  ) : (
                    <p className="text-red-700 dark:text-red-400">{test.error}</p>
                  )}
                </div>
              )}
              {sync && (
                <div className="rounded-lg border p-3 text-xs" role="status">
                  {"error" in sync ? (
                    <p className="text-red-700 dark:text-red-400">{sync.error}</p>
                  ) : (
                    <p>
                      <Badge variant="outline" className="mr-2 text-xs">{sync.status}{sync.reason ? ` (${sync.reason})` : ""}</Badge>
                      created {sync.created} · updated {sync.updated} · archived {sync.archived} · skipped {sync.skipped}
                      {sync.errors.length > 0 && <span className="block mt-1 text-red-700 dark:text-red-400">{sync.errors[0].message}</span>}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>}
        {saveError && <span role="alert" className="text-sm text-red-700 dark:text-red-400">{saveError}</span>}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Recent sync runs</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead><TableHead>Started</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Created</TableHead><TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Archived</TableHead><TableHead className="text-right">Skipped</TableHead>
                <TableHead>First error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialRuns.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No sync runs yet</TableCell></TableRow>
              )}
              {initialRuns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.source}</TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell className="text-right">{r.created}</TableCell>
                  <TableCell className="text-right">{r.updated}</TableCell>
                  <TableCell className="text-right">{r.archived}</TableCell>
                  <TableCell className="text-right">{r.skipped}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">{r.firstError ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
