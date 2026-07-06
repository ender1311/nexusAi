export const revalidate = 60;

import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { getAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/auth/demo";
import { demoEmailVariants } from "@/lib/mock/library-demo";
import { Header } from "@/components/layout/header";
import { EmailLibraryClient, type EmailGroup } from "@/components/email-library/email-library-client";
import type { EmailVariant } from "@/components/email-library/email-card";

const getEmailLibraryVariants = unstable_cache(
  () =>
    prisma.messageVariant.findMany({
      where: { message: { agentId: null, channel: "email" }, status: { not: "archived" } },
      select: {
        id: true, name: true, subject: true, body: true, deeplink: true,
        cta: true, status: true, category: true, subcategory: true, sortOrder: true,
        translations: {
          select: { language: true, subject: true, status: true },
          where: { status: "active" },
        },
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ["email-library-variants"],
  { tags: ["agents"], revalidate: 900 },
);

export default async function EmailLibraryPage() {
  const { canManageLibrary } = await getAuth();
  const variants = isDemoMode() ? demoEmailVariants : await getEmailLibraryVariants();

  const grouped = new Map<string, Map<string | null, EmailVariant[]>>();
  for (const v of variants) {
    const cat = v.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const subMap = grouped.get(cat)!;
    const sub = v.subcategory ?? null;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(v as EmailVariant);
  }
  const groups: EmailGroup[] = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
    Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
  );

  const totalVariants = variants.length;
  const totalLanguages = new Set(
    variants.flatMap((v) => v.translations.map((t) => t.language))
  ).size;

  const langCount = totalLanguages + 1;
  const description =
    totalVariants > 0
      ? `${totalVariants} template${totalVariants !== 1 ? "s" : ""} · ${langCount} ${langCount !== 1 ? "languages" : "language"}`
      : "Curated email templates from YouVersion campaigns";

  return (
    <>
      <Header title="Email Library" description={description} />
      <div className="p-4 sm:p-6 space-y-4">
        <EmailLibraryClient groups={groups} canManage={canManageLibrary} />
      </div>
    </>
  );
}
