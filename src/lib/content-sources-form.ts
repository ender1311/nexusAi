import { DEFAULT_MAPPINGS } from "@/lib/content-core";
import type { ContentSourceConfig } from "@/connectors/content/config";

export const MAPPING_KEYS = [
  "externalRef", "updatedAt", "title", "subject", "body", "cta", "deeplink", "imageUrl", "htmlBody", "tags",
] as const;
export type MappingKey = (typeof MAPPING_KEYS)[number];
export type MappingState = Partial<Record<MappingKey, string>>;

export const CHANNEL_OPTIONS = ["push", "email", "content_card", "slideup", "modal"] as const;
export type ChannelOption = (typeof CHANNEL_OPTIONS)[number];

export type PaginationState = { mode: "none" | "cursor" | "page"; nextPath: string; param: string; pageSize: string };

export type FormState = {
  enabled: Record<string, boolean>;
  contentful: { spaceId: string; environment: string; contentType: string; channel: ChannelOption; mapping: MappingState };
  sanity: { projectId: string; dataset: string; query: string; channel: ChannelOption; mapping: MappingState };
  genericJson: { url: string; itemsPath: string; channel: ChannelOption; pagination: PaginationState; mapping: MappingState };
  brazeCatalog: { catalogName: string; channel: ChannelOption; mapping: MappingState };
};

/** Source ids with an editable config block, in display order. */
export type ConfigurableSource = "contentful" | "sanity" | "generic-json" | "braze-catalog";
/** Shown as a placeholder so operators see what an empty mapping input falls back to. */
export function defaultMappingFor(source: ConfigurableSource, key: MappingKey): string {
  return DEFAULT_MAPPINGS[source][key] ?? "";
}

export function initialFormState(config: ContentSourceConfig): FormState {
  const g = config.genericJson;
  return {
    enabled: Object.fromEntries(config.enabled.map((id) => [id, true])),
    contentful: {
      spaceId: config.contentful?.spaceId ?? "", environment: config.contentful?.environment ?? "master",
      contentType: config.contentful?.contentType ?? "", channel: config.contentful?.channel ?? "push",
      mapping: { ...config.contentful?.mapping },
    },
    sanity: {
      projectId: config.sanity?.projectId ?? "", dataset: config.sanity?.dataset ?? "production",
      query: config.sanity?.query ?? "", channel: config.sanity?.channel ?? "push",
      mapping: { ...config.sanity?.mapping },
    },
    genericJson: {
      url: g?.url ?? "", itemsPath: g?.itemsPath ?? "", channel: g?.channel ?? "push",
      pagination: {
        mode: g?.pagination.mode ?? "none",
        nextPath: g?.pagination.mode === "cursor" ? g.pagination.nextPath : "",
        param: g?.pagination.mode === "cursor" || g?.pagination.mode === "page" ? g.pagination.param : "",
        pageSize: g?.pagination.mode === "page" ? String(g.pagination.pageSize) : "",
      },
      mapping: { ...g?.mapping },
    },
    brazeCatalog: {
      catalogName: config.brazeCatalog?.catalogName ?? "", channel: config.brazeCatalog?.channel ?? "push",
      mapping: { ...config.brazeCatalog?.mapping },
    },
  };
}

const compactMapping = (m: MappingState): Record<string, string> =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k, v]) => [k, (v as string).trim()]));

/**
 * Body for PUT /api/settings/content-sources. A source's block is sent when it is enabled or was already
 * saved, so disabling a source never drops its stored config. The server validates; this only shapes.
 */
export function buildSaveBody(state: FormState, initial: ContentSourceConfig): Record<string, unknown> {
  const enabled = ["nexus-library", ...(["contentful", "sanity", "generic-json", "braze-catalog"] as const).filter((id) => state.enabled[id])];
  const wants = (id: ConfigurableSource, saved: unknown) => !!state.enabled[id] || saved !== undefined;
  const body: Record<string, unknown> = { enabled };
  if (wants("contentful", initial.contentful)) {
    const c = state.contentful;
    body.contentful = { spaceId: c.spaceId, environment: c.environment, contentType: c.contentType, channel: c.channel, mapping: compactMapping(c.mapping) };
  }
  if (wants("sanity", initial.sanity)) {
    const s = state.sanity;
    body.sanity = { projectId: s.projectId, dataset: s.dataset, query: s.query, channel: s.channel, mapping: compactMapping(s.mapping) };
  }
  if (wants("generic-json", initial.genericJson)) {
    const g = state.genericJson;
    const pagination =
      g.pagination.mode === "cursor" ? { mode: "cursor", nextPath: g.pagination.nextPath, param: g.pagination.param }
      : g.pagination.mode === "page" ? { mode: "page", param: g.pagination.param, pageSize: Number(g.pagination.pageSize) }
      : { mode: "none" };
    body.genericJson = { url: g.url, itemsPath: g.itemsPath, channel: g.channel, pagination, mapping: compactMapping(g.mapping) };
  }
  if (wants("braze-catalog", initial.brazeCatalog)) {
    const b = state.brazeCatalog;
    body.brazeCatalog = { catalogName: b.catalogName, channel: b.channel, mapping: compactMapping(b.mapping) };
  }
  return body;
}
