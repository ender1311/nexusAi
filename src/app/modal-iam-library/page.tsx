export const revalidate = 60;

import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { getAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/auth/demo";
import { demoModalIamVariants } from "@/lib/mock/library-demo";
import { Header } from "@/components/layout/header";
import { ModalIamLibraryClient, type ModalIamGroup } from "@/components/modal-iam-library/modal-iam-library-client";
import type { ModalIamVariant } from "@/components/modal-iam-library/modal-iam-card";

const getModalIamLibraryVariants = unstable_cache(
  () =>
    prisma.messageVariant.findMany({
      where: { message: { agentId: null, channel: "modal-iam" }, status: { not: "archived" } },
      select: {
        id: true, name: true, title: true, body: true, deeplink: true, iconImageUrl: true,
        status: true, category: true, subcategory: true, sortOrder: true,
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ["modal-iam-library-variants"],
  { tags: ["agents"], revalidate: 900 },
);

export default async function ModalIamLibraryPage() {
  const { canManageLibrary } = await getAuth();
  const variants = isDemoMode() ? demoModalIamVariants : await getModalIamLibraryVariants();

  const grouped = new Map<string, Map<string | null, ModalIamVariant[]>>();
  for (const v of variants) {
    const cat = v.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const subMap = grouped.get(cat)!;
    const sub = v.subcategory ?? null;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(v as ModalIamVariant);
  }
  const groups: ModalIamGroup[] = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
    Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
  );

  const description =
    variants.length > 0
      ? `${variants.length} template${variants.length !== 1 ? "s" : ""} · Campaign-triggered via Braze`
      : "Modal in-app message templates triggered via Braze campaigns";

  return (
    <>
      <Header title="Modal IAM Library" description={description} />
      <div className="p-4 sm:p-6 space-y-4">
        <ModalIamLibraryClient groups={groups} canManage={canManageLibrary} />
      </div>
    </>
  );
}
