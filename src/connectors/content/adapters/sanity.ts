import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition, requireJsonObject } from "../http";
import { ContentSourceError, ContentSourceNotConfigured, type ContentSource } from "../types";

const PAGE = 100;

export function sanitySource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const s = config.sanity;
  if (!s) throw new ContentSourceNotConfigured("Sanity is not configured");
  const mapping = { ...DEFAULT_MAPPINGS.sanity, ...s.mapping };
  const headers: Record<string, string> = env.SANITY_READ_TOKEN ? { Authorization: `Bearer ${env.SANITY_READ_TOKEN}` } : {};

  async function slice(from: number, to: number) {
    const q = `${s!.query}[${from}...${to}]`;
    const url = `https://${s!.projectId}.api.sanity.io/v2025-02-19/data/query/${encodeURIComponent(s!.dataset)}?query=${encodeURIComponent(q)}`;
    const r = await fetchJson(url, { headers }, fetchImpl);
    if (r.status !== 200) throw new ContentSourceError(`Sanity responded ${r.status}`);
    const result = requireJsonObject(r.json, "Sanity").result;
    if (!Array.isArray(result)) throw new ContentSourceError("Sanity query did not return an array");
    return result;
  }
  const map = (docs: unknown[]) => partition(docs.map((raw) => {
    const r = applyFieldMapping(raw, mapping, { channel: s.channel });
    return "item" in r ? r : { error: r.error, ref: String(getPath(raw, "_id") ?? "(no id)") };
  }));

  return {
    id: "sanity",
    activation: "inline",
    async listItems(cursor) {
      const from = cursor ? Number(cursor) : 0;
      if (!Number.isInteger(from) || from < 0) throw new ContentSourceError("Invalid cursor");
      const docs = await slice(from, from + PAGE);
      return { ...map(docs), next: docs.length >= PAGE ? String(from + PAGE) : undefined };
    },
    async testConnection() {
      try { return { ok: true, sample: map(await slice(0, 3)).items }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Sanity request failed" }; }
    },
  };
}
