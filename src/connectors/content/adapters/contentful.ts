import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition, requireJsonObject } from "../http";
import { ContentSourceError, ContentSourceNotConfigured, type ContentSource } from "../types";

const PAGE = 100;

export function contentfulSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const c = config.contentful;
  if (!c) throw new ContentSourceNotConfigured("Contentful is not configured");
  const token = env.CONTENTFUL_DELIVERY_TOKEN;
  if (!token) throw new ContentSourceNotConfigured("CONTENTFUL_DELIVERY_TOKEN is not set");
  const mapping = { ...DEFAULT_MAPPINGS.contentful, ...c.mapping };
  const base = `https://cdn.contentful.com/spaces/${encodeURIComponent(c.spaceId)}/environments/${encodeURIComponent(c.environment)}/entries`;

  async function page(skip: number, limit: number) {
    const url = `${base}?content_type=${encodeURIComponent(c!.contentType)}&locale=*&order=sys.createdAt&skip=${skip}&limit=${limit}`;
    const r = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
    if (r.status !== 200) throw new ContentSourceError(`Contentful responded ${r.status}`);
    return requireJsonObject(r.json, "Contentful") as { items?: unknown[]; total?: number; skip?: number };
  }

  function map(items: unknown[]) {
    return partition(items.map((raw) => {
      const r = applyFieldMapping(raw, mapping, { channel: c!.channel });
      return "item" in r ? r : { error: r.error, ref: String(getPath(raw, "sys.id") ?? "(no id)") };
    }));
  }

  return {
    id: "contentful",
    activation: "inline",
    async listItems(cursor) {
      const skip = cursor ? Number(cursor) : 0;
      if (!Number.isInteger(skip) || skip < 0) throw new ContentSourceError("Invalid cursor");
      const body = await page(skip, PAGE);
      const items = body.items ?? [];
      const nextSkip = skip + items.length;
      return { ...map(items), next: items.length > 0 && nextSkip < (body.total ?? 0) ? String(nextSkip) : undefined };
    },
    async testConnection() {
      try {
        return { ok: true, sample: map((await page(0, 3)).items ?? []).items };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Contentful request failed" };
      }
    },
  };
}
