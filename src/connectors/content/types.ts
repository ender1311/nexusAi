import type { ContentItem } from "@/lib/content-core";
import type { ContentSourceId } from "./config";

export type ListPage = { items: ContentItem[]; skipped: { externalRef: string; error: string }[]; next?: string };

export interface ContentSource {
  id: ContentSourceId;
  activation: "inline" | "reference";
  testConnection(): Promise<{ ok: true; sample: ContentItem[] } | { ok: false; error: string }>;
  listItems(cursor?: string): Promise<ListPage>;
}

/** An adapter error whose message is fixed text, safe to store and show (no upstream bodies or secrets). */
export class ContentSourceError extends Error {}
export class ContentSourceNotConfigured extends ContentSourceError {}
