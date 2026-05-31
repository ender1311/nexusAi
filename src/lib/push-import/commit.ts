import type { prisma as prismaClient } from "@/lib/db";
import type { ImportPlan } from "./types";

export type CommitResult = { created: number; updated: number; englishRefreshed: number };

/**
 * Apply an import plan to the DB: upsert MessageVariantTranslation rows by
 * (messageVariantId, language). When refreshEnglish is true, also overwrite the
 * matched variant's English body from the en anchor where it diverged.
 * Idempotent via the unique key. No deletes.
 */
export async function commitImportPlan(
  plan: ImportPlan,
  prisma: typeof prismaClient,
  opts: { source: string; refreshEnglish: boolean },
): Promise<CommitResult> {
  let created = 0, updated = 0, englishRefreshed = 0;

  for (const stem of plan.matched) {
    for (const lang of stem.languages) {
      const existing = await prisma.messageVariantTranslation.findUnique({
        where: { messageVariantId_language: { messageVariantId: stem.messageVariantId, language: lang.language } },
        select: { id: true },
      });
      await prisma.messageVariantTranslation.upsert({
        where: { messageVariantId_language: { messageVariantId: stem.messageVariantId, language: lang.language } },
        create: {
          messageVariantId: stem.messageVariantId,
          language: lang.language,
          title: lang.title,
          body: lang.body,
          bodyPersonal: lang.bodyPersonal,
          status: "active",
          source: opts.source,
          sourceFile: `${stem.stem}-${lang.language}`,
        },
        update: {
          title: lang.title,
          body: lang.body,
          bodyPersonal: lang.bodyPersonal,
          status: "active",
          source: opts.source,
          sourceFile: `${stem.stem}-${lang.language}`,
        },
      });
      if (existing) updated++; else created++;
    }

    if (opts.refreshEnglish && stem.englishDivergence) {
      await prisma.messageVariant.update({
        where: { id: stem.messageVariantId },
        data: { body: stem.englishDivergence.incoming },
      });
      englishRefreshed++;
    }
  }

  return { created, updated, englishRefreshed };
}
