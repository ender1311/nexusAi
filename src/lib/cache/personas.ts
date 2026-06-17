/**
 * Persona-scoped `unstable_cache` wrappers.
 * See ./index.ts for the tag taxonomy.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { TTL } from "./ttl";

/** Active personas with minimal fields — used in dropdowns/selectors. */
export const getCachedActivePersonas = unstable_cache(
  () =>
    prisma.persona.findMany({
      where: { isActive: true },
      select: { id: true, name: true, label: true, icon: true, color: true },
      orderBy: { name: "asc" },
    }),
  ["personas-active"],
  { tags: ["personas"], revalidate: TTL.STANDARD }
);

/**
 * Persona distribution with user counts for the dashboard chart.
 * Reads the precomputed `userCount` column (refreshed by the refresh-persona-counts
 * cron) instead of a live `_count.trackedUsers`, which is a correlated COUNT over
 * the ~39M-row User table per persona (~100s — blew the 30s page timeout).
 */
export const getCachedPersonaDistribution = cache(
  unstable_cache(
    () =>
      prisma.persona.findMany({
        where: { isActive: true },
        select: { name: true, label: true, color: true, userCount: true },
        orderBy: { userCount: { sort: "desc", nulls: "last" } },
        take: 20,
      }),
    ["personas-distribution"],
    { tags: ["personas"], revalidate: TTL.STANDARD }
  )
);
