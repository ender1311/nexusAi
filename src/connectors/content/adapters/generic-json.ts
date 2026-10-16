import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition } from "../http";
import { ContentSourceNotConfigured, type ContentSource } from "../types";

export function genericJsonSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const g = config.genericJson;
  if (!g) throw new ContentSourceNotConfigured("Generic JSON source is not configured");
  const mapping = { ...DEFAULT_MAPPINGS["generic-json"], ...g.mapping };
  const headers: Record<string, string> = env.GENERIC_CONTENT_TOKEN ? { Authorization: `Bearer ${env.GENERIC_CONTENT_TOKEN}` } : {};

  function urlFor(cursor?: string): string {
    const u = new URL(g!.url);
    if (g!.pagination.mode === "cursor" && cursor) u.searchParams.set(g!.pagination.param, cursor);
    if (g!.pagination.mode === "page") u.searchParams.set(g!.pagination.param, cursor ?? "1");
    return u.toString();
  }
  async function fetchPage(cursor?: string) {
    const r = await fetchJson(urlFor(cursor), { headers }, fetchImpl);
    if (r.status !== 200) throw new Error(`Content endpoint responded ${r.status}`);
    const items = getPath(r.json, g!.itemsPath);
    if (!Array.isArray(items)) throw new Error(`itemsPath "${g!.itemsPath}" did not resolve to an array`);
    return { items, json: r.json };
  }
  const map = (items: unknown[]) => partition(items.map((raw) => {
    const r = applyFieldMapping(raw, mapping, { channel: g.channel });
    return "item" in r ? r : { error: r.error, ref: String(getPath(raw, mapping.externalRef ?? "id") ?? "(no id)") };
  }));

  return {
    id: "generic-json",
    activation: "inline",
    async listItems(cursor) {
      const { items, json } = await fetchPage(cursor);
      let next: string | undefined;
      const p = g.pagination;
      if (p.mode === "cursor") { const n = getPath(json, p.nextPath); next = typeof n === "string" && n ? n : undefined; }
      if (p.mode === "page") next = items.length >= p.pageSize ? String(Number(cursor ?? "1") + 1) : undefined;
      return { ...map(items), next };
    },
    async testConnection() {
      try { return { ok: true, sample: map((await fetchPage()).items.slice(0, 3)).items }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Content endpoint request failed" }; }
    },
  };
}
