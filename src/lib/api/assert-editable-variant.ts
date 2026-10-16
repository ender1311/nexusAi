import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/api/respond";

/**
 * Fields a content source owns for a synced variant. Operators can still pause, archive,
 * reorder, recategorize and schedule synced variants (the kill switch); they cannot edit copy.
 */
export const SYNCED_COPY_FIELDS: ReadonlySet<string> = new Set([
  "name", "subject", "body", "cta", "title", "iconImageUrl", "deeplink", "htmlBody",
]);

/** Synced variants are read-only in Nexus — edits happen at the source. */
export async function assertEditableVariant(variantId: string): Promise<NextResponse<{ error: string }> | null> {
  const v = await prisma.messageVariant.findUnique({ where: { id: variantId }, select: { contentSource: true } });
  if (v && v.contentSource !== "nexus-library") return fail(`This variant is synced from ${v.contentSource}; edit it at the source.`, 409);
  return null;
}
