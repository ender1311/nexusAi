export const revalidate = 60;

import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { getAuth } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { SlideupLibraryClient, type SlideupGroup } from "@/components/slideup-library/slideup-library-client";
import type { SlideupVariant } from "@/components/slideup-library/slideup-card";

const getSlideupLibraryVariants = unstable_cache(
  () =>
    prisma.messageVariant.findMany({
      where: { message: { agentId: null, channel: "in-app" }, status: { not: "archived" } },
      select: {
        id: true, name: true, title: true, body: true, deeplink: true, iconImageUrl: true,
        status: true, category: true, subcategory: true, sortOrder: true,
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ["slideup-library-variants"],
  { tags: ["agents"], revalidate: 900 },
);

export default async function SlideupLibraryPage() {
  const { canManageLibrary } = await getAuth();
  const variants = await getSlideupLibraryVariants();

  const grouped = new Map<string, Map<string | null, SlideupVariant[]>>();
  for (const v of variants) {
    const cat = v.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const subMap = grouped.get(cat)!;
    const sub = v.subcategory ?? null;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(v as SlideupVariant);
  }
  const groups: SlideupGroup[] = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
    Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
  );

  const description =
    variants.length > 0
      ? `${variants.length} template${variants.length !== 1 ? "s" : ""} · Canvas-triggered via Braze`
      : "Slideup in-app message templates triggered via Braze canvas";

  return (
    <>
      <Header title="Slideup Library" description={description} />
      <div className="p-4 sm:p-6 space-y-4">
        <SlideupLibraryClient groups={groups} canManage={canManageLibrary} />
      </div>
    </>
  );
}
