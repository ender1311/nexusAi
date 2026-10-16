import { prisma } from "@/lib/db";
import type { ContentItem } from "@/lib/content-core";
import { getContentSourceConfig, type ContentSourceId } from "./config";
import { createContentSource } from "./registry";
import type { ContentSource } from "./types";

export type SyncResult = {
  status: "ok" | "partial" | "failed" | "skipped";
  reason?: "locked" | "not-enabled";
  created: number; updated: number; archived: number; skipped: number;
  errors: { externalRef: string; message: string }[];
};
const MAX_ERRORS = 50;
const MAX_PAGES = 500;
export const LIBRARY_MESSAGE_NAME = (source: string, channel: string) => `[${source}] ${channel} library`;

const copyOf = (i: ContentItem) => ({
  name: i.title ?? i.externalRef, title: i.title ?? null, subject: i.subject ?? null, body: i.body,
  cta: i.cta ?? null, deeplink: i.deeplink ?? null, iconImageUrl: i.imageUrl ?? null, htmlBody: i.htmlBody ?? null,
});

export async function syncContentSource(id: ContentSourceId, deps: { source?: ContentSource; now?: () => Date } = {}): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const empty = { created: 0, updated: 0, archived: 0, skipped: 0, errors: [] as SyncResult["errors"] };
  const config = await getContentSourceConfig();
  if (!config.enabled.includes(id)) return { status: "skipped", reason: "not-enabled", ...empty };

  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`content-sync:${id}`})) AS locked`;
    if (!locked) return { status: "skipped" as const, reason: "locked" as const, ...empty };

    const result: SyncResult = { status: "ok", ...empty, errors: [] };
    const startedAt = now();
    const seen = new Set<string>();
    let complete = false;
    try {
      const source = deps.source ?? createContentSource(id, config);
      let cursor: string | undefined;
      for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
        const page = await source.listItems(cursor);
        for (const s of page.skipped) {
          result.skipped++;
          if (result.errors.length < MAX_ERRORS) result.errors.push({ externalRef: s.externalRef, message: s.error });
        }
        for (const item of page.items) {
          seen.add(item.externalRef);
          await upsertItem(tx, id, item, now(), result);
        }
        if (!page.next) { complete = true; break; }
        cursor = page.next;
      }
    } catch (e) {
      result.status = "failed";
      result.errors.push({ externalRef: "(listing)", message: e instanceof Error ? e.message : "sync failed" });
    }
    // Only a complete listing may archive: a partial listing doesn't prove absence.
    if (complete) {
      const stale = await tx.messageVariant.updateMany({
        where: { contentSource: id, externalRef: { notIn: [...seen] }, status: { not: "archived" } },
        data: { status: "archived" },
      });
      result.archived = stale.count;
      if (result.skipped > 0) result.status = "partial";
    }
    await tx.contentSyncRun.create({
      data: { source: id, startedAt, finishedAt: now(), status: result.status, created: result.created, updated: result.updated,
        archived: result.archived, skipped: result.skipped, errors: result.errors.slice(0, MAX_ERRORS) },
    });
    return result;
  }, { timeout: 120_000, maxWait: 5_000 });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertItem(tx: Tx, source: string, item: ContentItem, at: Date, result: SyncResult) {
  const name = LIBRARY_MESSAGE_NAME(source, item.channel);
  const message = (await tx.message.findFirst({ where: { agentId: null, contentSource: source, channel: item.channel, name } }))
    ?? (await tx.message.create({ data: { name, channel: item.channel, contentSource: source } }));
  const existing = await tx.messageVariant.findFirst({ where: { contentSource: source, externalRef: item.externalRef } });
  const copy = copyOf(item);
  let variantId: string;
  if (!existing) {
    variantId = (await tx.messageVariant.create({ data: { ...copy, messageId: message.id, contentSource: source, externalRef: item.externalRef, syncedAt: at, status: "active" } })).id;
    result.created++;
  } else {
    variantId = existing.id;
    const changed = (Object.keys(copy) as (keyof typeof copy)[]).some((k) => existing[k] !== copy[k]) || existing.status === "archived";
    if (changed) {
      await tx.messageVariant.update({ where: { id: existing.id }, data: { ...copy, status: "active", syncedAt: at } });
      result.updated++;
    }
  }
  for (const [language, l] of Object.entries(item.locales ?? {})) {
    if (!l.body) continue; // translation.body is required
    await tx.messageVariantTranslation.upsert({
      where: { messageVariantId_language: { messageVariantId: variantId, language } },
      create: { messageVariantId: variantId, language, title: l.title ?? null, body: l.body, subject: l.subject ?? null },
      update: { title: l.title ?? null, body: l.body, subject: l.subject ?? null },
    });
  }
}
