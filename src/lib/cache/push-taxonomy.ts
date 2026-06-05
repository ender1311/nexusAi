import { unstable_cache } from "next/cache";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { TTL } from "./ttl";
import type { PushTaxonomy } from "@/lib/push-taxonomy";

export const PUSH_TAXONOMY_TAG = "push-taxonomy";

/** Raw DB read (no cache) — exported for tests and for the cached wrapper. */
export async function getPushTaxonomyUncached(): Promise<PushTaxonomy> {
  const categories = await prisma.pushCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { subcategories: { orderBy: { sortOrder: "asc" } } },
  });
  return categories.map((c) => ({
    id: c.id,
    slug: c.slug,
    label: c.label,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    subcategories: c.subcategories.map((s) => ({
      id: s.id,
      slug: s.slug,
      label: s.label,
      sortOrder: s.sortOrder,
      deeplinkBehavior: s.deeplinkBehavior,
      isActive: s.isActive,
    })),
  }));
}

/** Cached taxonomy. Busted by `revalidateTag(PUSH_TAXONOMY_TAG)` on any mutation. */
export const getPushTaxonomy = cache(
  unstable_cache(getPushTaxonomyUncached, ["push-taxonomy"], {
    tags: [PUSH_TAXONOMY_TAG],
    revalidate: TTL.DAY,
  }),
);
