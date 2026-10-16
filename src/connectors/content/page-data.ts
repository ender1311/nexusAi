import { prisma } from "@/lib/db";
import { getContentSourceConfig, type ContentSourceConfig } from "./config";

export type TokenPresence = { contentful: boolean; sanity: boolean; genericJson: boolean; braze: boolean };

export type SyncRunRow = {
  id: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  created: number;
  updated: number;
  archived: number;
  skipped: number;
  firstError: string | null;
};

export type ContentSourcesPageData = {
  config: ContentSourceConfig;
  tokens: TokenPresence;
  runs: SyncRunRow[];
};

/** First error message out of a stored `errors` JSON column; tolerant of malformed rows. */
export function firstErrorMessage(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first: unknown = errors[0];
  if (typeof first === "string") return first;
  if (typeof first === "object" && first !== null && "message" in first && typeof first.message === "string") {
    return first.message;
  }
  return null;
}

export function readTokenPresence(): TokenPresence {
  return {
    contentful: !!process.env.CONTENTFUL_DELIVERY_TOKEN,
    sanity: !!process.env.SANITY_READ_TOKEN,
    genericJson: !!process.env.GENERIC_CONTENT_TOKEN,
    braze: !!process.env.BRAZE_API_KEY,
  };
}

export async function loadContentSourcesPageData(): Promise<ContentSourcesPageData> {
  const [config, runs] = await Promise.all([
    getContentSourceConfig(),
    prisma.contentSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
  ]);
  return {
    config,
    tokens: readTokenPresence(),
    runs: runs.map((r) => ({
      id: r.id,
      source: r.source,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      status: r.status,
      created: r.created,
      updated: r.updated,
      archived: r.archived,
      skipped: r.skipped,
      firstError: firstErrorMessage(r.errors),
    })),
  };
}
