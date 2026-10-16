import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/api/respond";

const lockedMessage = (source: string) => `This variant is synced from ${source}; edit it at the source.`;

/** Synced variants are read-only in Nexus — edits happen at the source. */
export async function assertEditableVariant(variantId: string): Promise<NextResponse<{ error: string }> | null> {
  const v = await prisma.messageVariant.findUnique({ where: { id: variantId }, select: { contentSource: true } });
  if (v && v.contentSource !== "nexus-library") return fail(lockedMessage(v.contentSource), 409);
  return null;
}

/** Same guard for routes that mutate several variants at once: blocks if any one is synced. */
export async function assertEditableVariants(variantIds: string[]): Promise<NextResponse<{ error: string }> | null> {
  const synced = await prisma.messageVariant.findFirst({
    where: { id: { in: variantIds }, contentSource: { not: "nexus-library" } },
    select: { contentSource: true },
  });
  return synced ? fail(lockedMessage(synced.contentSource), 409) : null;
}
