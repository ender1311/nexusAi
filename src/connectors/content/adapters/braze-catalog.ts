import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition, requireJsonObject } from "../http";
import { ContentSourceError, ContentSourceNotConfigured, type ContentSource } from "../types";

function nextFromLink(link: string | null, origin: string): string | undefined {
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  if (!m?.[1]) return undefined;
  try { return new URL(m[1], origin).toString(); } catch { return undefined; }
}

export function brazeCatalogSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const b = config.brazeCatalog;
  if (!b) throw new ContentSourceNotConfigured("Braze catalog is not configured");
  const key = env.BRAZE_API_KEY;
  const endpoint = env.BRAZE_REST_ENDPOINT ?? env.BRAZE_REST_URL;
  if (!key || !endpoint) throw new ContentSourceNotConfigured("BRAZE_API_KEY and BRAZE_REST_ENDPOINT must be set");
  let origin: string;
  try { origin = new URL(endpoint).origin; } catch { throw new ContentSourceNotConfigured("BRAZE_REST_ENDPOINT is not a valid URL"); }
  const mapping = { ...DEFAULT_MAPPINGS["braze-catalog"], ...b.mapping };
  const first = `${origin}/catalogs/${b.catalogName}/items`;

  async function fetchPage(url: string) {
    if (new URL(url).origin !== origin) throw new ContentSourceError("Refusing cursor outside the Braze REST endpoint");
    const r = await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } }, fetchImpl);
    if (r.status !== 200) throw new ContentSourceError(`Braze catalogs responded ${r.status}`);
    const items = requireJsonObject(r.json, "Braze catalogs").items;
    if (!Array.isArray(items)) throw new ContentSourceError("Braze catalogs response had no items array");
    const next = nextFromLink(r.headers.get("link"), origin);
    return { items, next: next === url ? undefined : next };
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
