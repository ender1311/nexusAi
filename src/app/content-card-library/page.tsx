export const revalidate = 60;

import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { getAuth } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { ContentCardLibraryClient, type ContentCardGroup } from "@/components/content-card-library/content-card-library-client";
import type { ContentCardVariant } from "@/components/content-card-library/content-card-card";

const getContentCardLibraryVariants = unstable_cache(
  () =>
    prisma.messageVariant.findMany({
      where: { message: { agentId: null, channel: "content-card" }, status: { not: "archived" } },
      select: {
        id: true, name: true, title: true, body: true, cta: true, deeplink: true,
        status: true, category: true, subcategory: true, sortOrder: true,
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ["content-card-library-variants"],
  { tags: ["agents"], revalidate: 900 },
);

export default async function ContentCardLibraryPage() {
  const { canManageLibrary } = await getAuth();
  const variants = await getContentCardLibraryVariants();

  const grouped = new Map<string, Map<string | null, ContentCardVariant[]>>();
  for (const v of variants) {
    const cat = v.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const subMap = grouped.get(cat)!;
    const sub = v.subcategory ?? null;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(v as ContentCardVariant);
  }
  const groups: ContentCardGroup[] = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
    Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
  );

  const description =
    variants.length > 0
      ? `${variants.length} template${variants.length !== 1 ? "s" : ""} · API-triggered via Braze campaign`
      : "Content card templates sent via Braze API trigger";

  return (
    <>
      <Header title="Content Card Library" description={description} />
      <div className="p-4 sm:p-6 space-y-4">
        <ContentCardLibraryClient groups={groups} canManage={canManageLibrary} />
      </div>
    </>
  );
}
