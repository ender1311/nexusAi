import type { ContentItem } from "@/lib/content-core";
import type { ContentSourceId } from "./config";

export type ListPage = { items: ContentItem[]; skipped: { externalRef: string; error: string }[]; next?: string };

export interface ContentSource {
  id: ContentSourceId;
  activation: "inline" | "reference";
  testConnection(): Promise<{ ok: true; sample: ContentItem[] } | { ok: false; error: string }>;
  listItems(cursor?: string): Promise<ListPage>;
}

export class ContentSourceNotConfigured extends Error {}
