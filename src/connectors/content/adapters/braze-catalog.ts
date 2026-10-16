import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition } from "../http";
import { ContentSourceNotConfigured, type ContentSource } from "../types";

function nextFromLink(link: string | null): string | undefined {
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  return m?.[1];
}

export function brazeCatalogSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const b = config.brazeCatalog;
  if (!b) throw new ContentSourceNotConfigured("Braze catalog is not configured");
  const key = env.BRAZE_API_KEY;
  const endpoint = env.BRAZE_REST_ENDPOINT ?? env.BRAZE_REST_URL;
  if (!key || !endpoint) throw new ContentSourceNotConfigured("BRAZE_API_KEY and BRAZE_REST_ENDPOINT must be set");
  const origin = new URL(endpoint).origin;
  const mapping = { ...DEFAULT_MAPPINGS["braze-catalog"], ...b.mapping };
  const first = `${origin}/catalogs/${b.catalogName}/items`;

  async function fetchPage(url: string) {
    if (new URL(url).origin !== origin) throw new Error("Refusing cursor outside the Braze REST endpoint");
    const r = await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } }, fetchImpl);
    if (r.status !== 200) throw new Error(`Braze catalogs responded ${r.status}`);
    const items = (r.json as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new Error("Braze catalogs response had no items array");
    return { items, next: nextFromLink(r.headers.get("link")) };
  }
  const map = (items: unknown[]) => partition(items.map((raw) => {
    const r = applyFieldMapping(raw, mapping, { channel: b.channel });
    return "item" in r ? r : { error: r.error, ref: String(getPath(raw, "id") ?? "(no id)") };
  }));

  return {
    id: "braze-catalog",
    activation: "reference",
    async listItems(cursor) {
      const p = await fetchPage(cursor ?? first);
      return { ...map(p.items), next: p.next };
    },
    async testConnection() {
      try { return { ok: true, sample: map((await fetchPage(first)).items.slice(0, 3)).items }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Braze catalogs request failed" }; }
    },
  };
}
