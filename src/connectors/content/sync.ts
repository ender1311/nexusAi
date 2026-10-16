import { prisma } from "@/lib/db";
import type { ContentItem } from "@/lib/content-core";
import { getContentSourceConfig, type ContentSourceId } from "./config";
import { createContentSource } from "./registry";
import type { ContentSource } from "./types";

export type SyncResult = {
  status: "ok" | "partial" | "failed" | "skipped";
  reason?: "locked" | "not-enabled" | "not-syncable";
  created: number; updated: number; archived: number; skipped: number;
  errors: { externalRef: string; message: string }[];
};
const MAX_ERRORS = 50;
export const MAX_PAGES = 500;
const STALE_LEASE_MINUTES = 15;
export const LIBRARY_MESSAGE_NAME = (source: string, channel: string) => `[${source}] ${channel} library`;

const copyOf = (i: ContentItem) => ({
  name: i.title ?? i.externalRef, title: i.title ?? null, subject: i.subject ?? null, body: i.body,
  cta: i.cta ?? null, deeplink: i.deeplink ?? null, iconImageUrl: i.imageUrl ?? null, htmlBody: i.htmlBody ?? null,
});

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Deps = { source?: ContentSource; now?: () => Date; maxPages?: number };

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  if (code === "P2002" || code === "23505") return true;
  return /23505|unique constraint/i.test(e instanceof Error ? e.message : "");
}

/** Takes the per-source lease: expires stale ones, then inserts a 'running' row. Returns the row id, or null if another run holds it. */
async function acquireLease(id: string, startedAt: Date): Promise<string | null> {
  await prisma.$executeRaw`UPDATE "ContentSyncRun"
    SET status = 'failed', "finishedAt" = now(), errors = '[{"externalRef":"(lease)","message":"stale lease expired"}]'::jsonb
    WHERE source = ${id} AND status = 'running' AND "startedAt" < now() - make_interval(mins => ${STALE_LEASE_MINUTES})`;
  try {
    const row = await prisma.contentSyncRun.create({ data: { source: id, status: "running", startedAt } });
    return row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

export async function syncContentSource(id: ContentSourceId, deps: Deps = {}): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const maxPages = deps.maxPages ?? MAX_PAGES;
  const result: SyncResult = { status: "ok", created: 0, updated: 0, archived: 0, skipped: 0, errors: [] };
  // The native library has no external listing: syncing it would archive everything.
  if (id === "nexus-library") return { ...result, status: "skipped", reason: "not-syncable" };
  const config = await getContentSourceConfig();
  if (!config.enabled.includes(id)) return { ...result, status: "skipped", reason: "not-enabled" };

  const runId = await acquireLease(id, now());
  if (!runId) return { ...result, status: "skipped", reason: "locked" };

  const addError = (externalRef: string, message: string) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push({ externalRef, message });
  };
  let failed = false;
  let degraded = false; // finished but incomplete or suspicious: report partial, archive nothing
  try {
    const seen = new Set<string>();
    const messageIds = new Map<string, string>();
    let complete = false;
    let cursor: string | undefined;
    try {
      const source = deps.source ?? createContentSource(id, config);
      for (let pageNo = 0; ; pageNo++) {
        if (pageNo >= maxPages) {
          degraded = true;
          addError("(listing)", "page limit reached");
          break;
        }
        const page = await source.listItems(cursor); // no transaction open while fetching
        for (const s of page.skipped) { result.skipped++; addError(s.externalRef, s.error); }
        try {
          await writePage(id, page.items, messageIds, seen, now(), result);
        } catch (e) {
          failed = true;
          addError("(database)", e instanceof Error ? e.message : "database error");
          break;
        }
        if (!page.next) { complete = true; break; }
        cursor = page.next;
      }
    } catch (e) {
      failed = true;
      addError("(listing)", e instanceof Error ? e.message : "sync failed");
    }

    // Only a complete listing may archive: a partial listing doesn't prove absence.
    if (complete && !failed) {
      try {
        const live = await prisma.messageVariant.count({ where: { contentSource: id, externalRef: { not: null }, status: { not: "archived" } } });
        if (seen.size === 0 && live > 0) {
          degraded = true;
          addError("(listing)", "Source returned no items; refusing to archive all synced content");
        } else {
          result.archived = await archiveMissing(id, [...seen]);
        }
      } catch (e) {
        failed = true;
        addError("(database)", e instanceof Error ? e.message : "database error");
      }
    }
  } finally {
    result.status = failed ? "failed" : degraded || result.skipped > 0 ? "partial" : "ok";
    await prisma.contentSyncRun.update({
      where: { id: runId },
      data: { finishedAt: now(), status: result.status, created: result.created, updated: result.updated,
        archived: result.archived, skipped: result.skipped, errors: result.errors.slice(0, MAX_ERRORS) },
    });
  }
  return result;
}

/** Archives synced variants absent from `seenRefs`. One array parameter, so Postgres' 65535 bind limit doesn't cap the listing size. */
export async function archiveMissing(source: string, seenRefs: string[]): Promise<number> {
  return prisma.$executeRaw`UPDATE "MessageVariant" SET status = 'archived'
    WHERE "contentSource" = ${source} AND "externalRef" IS NOT NULL AND "externalRef" <> ALL(${seenRefs}::text[]) AND status <> 'archived'`;
}

/** Resolves the library Message per channel once per run (outside the page transaction; the lease prevents races). */
async function libraryMessageId(source: string, channel: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(channel);
  if (cached) return cached;
  const name = LIBRARY_MESSAGE_NAME(source, channel);
  const message = (await prisma.message.findFirst({ where: { agentId: null, contentSource: source, channel, name } }))
    ?? (await prisma.message.create({ data: { name, channel, contentSource: source } }));
  cache.set(channel, message.id);
  return message.id;
}

async function writePage(source: string, items: ContentItem[], messageIds: Map<string, string>, seen: Set<string>, at: Date, result: SyncResult) {
  const perItemMessageId = new Map<string, string>();
  for (const item of items) perItemMessageId.set(item.externalRef, await libraryMessageId(source, item.channel, messageIds));
  // Counters are applied only after the page commits, so a rolled-back page isn't counted.
  const page = { created: 0, updated: 0 };
  await prisma.$transaction(async (tx) => {
    for (const item of items) await upsertItem(tx, source, item, perItemMessageId.get(item.externalRef)!, at, page);
  }, { timeout: 60_000, maxWait: 5_000 });
  result.created += page.created;
  result.updated += page.updated;
  for (const item of items) seen.add(item.externalRef);
}

async function upsertItem(tx: Tx, source: string, item: ContentItem, messageId: string, at: Date, counts: { created: number; updated: number }) {
  const existing = await tx.messageVariant.findFirst({ where: { contentSource: source, externalRef: item.externalRef }, include: { translations: true } });
  const copy = copyOf(item);
  const locales = Object.entries(item.locales ?? {}).filter(([, l]) => !!l.body); // translation.body is required
  let variantId: string;
  let touched = false;
  if (!existing) {
    variantId = (await tx.messageVariant.create({ data: { ...copy, messageId, contentSource: source, externalRef: item.externalRef, syncedAt: at, status: "active" } })).id;
    counts.created++;
  } else {
    variantId = existing.id;
    const copyChanged = (Object.keys(copy) as (keyof typeof copy)[]).some((k) => existing[k] !== copy[k])
      || existing.status === "archived" || existing.messageId !== messageId;
    const translationsChanged = locales.some(([language, l]) => {
      const t = existing.translations.find((x) => x.language === language);
      return !t || t.body !== l.body || t.title !== (l.title ?? null) || t.subject !== (l.subject ?? null);
    });
    if (copyChanged) {
      await tx.messageVariant.update({ where: { id: existing.id }, data: { ...copy, messageId, status: "active", syncedAt: at } });
    } else if (translationsChanged) {
      await tx.messageVariant.update({ where: { id: existing.id }, data: { syncedAt: at } });
    }
    touched = copyChanged || translationsChanged;
    if (touched) counts.updated++;
  }
  if (existing && !touched) return;
  for (const [language, l] of locales) {
    await tx.messageVariantTranslation.upsert({
      where: { messageVariantId_language: { messageVariantId: variantId, language } },
      create: { messageVariantId: variantId, language, title: l.title ?? null, body: l.body!, subject: l.subject ?? null },
      update: { title: l.title ?? null, body: l.body!, subject: l.subject ?? null },
    });
  }
}
