/**
 * Segment `unstable_cache` wrappers.
 * See ./index.ts for the tag taxonomy.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { parseSegmentTargeting } from "@/lib/agent-targeting";
import { TTL } from "./ttl";

export type SegmentInfo = { name: string; userCount: number; assignedTo: string | null };

/** Distinct HT segments with member count and assigned agent. Busted by POST /api/ingest/segments. */
export const getCachedSegments = unstable_cache(
  async (): Promise<SegmentInfo[]> => {
    const [rows, agents] = await Promise.all([
      // source='hightouch' only: rule-materialized rows share segmentName and would
      // otherwise double-count membership and surface a duplicate row in the sizes table.
      prisma.userSegment.groupBy({
        by: ["segmentName"],
        where: { source: "hightouch" },
        _count: { _all: true },
        orderBy: { segmentName: "asc" },
      }),
      prisma.agent.findMany({
        where: {
          OR: [
            { targetSegmentName: { not: null } },
            { segmentTargeting: { not: Prisma.JsonNullValueFilter.DbNull } },
          ],
        },
        select: { targetSegmentName: true, name: true, segmentTargeting: true },
      }),
    ]);
    const assignedTo = new Map<string, string>();
    for (const a of agents) {
      if (a.targetSegmentName) assignedTo.set(a.targetSegmentName, a.name);
      const st = parseSegmentTargeting(a.segmentTargeting);
      for (const seg of st?.includes ?? []) {
        if (!assignedTo.has(seg)) assignedTo.set(seg, a.name);
      }
    }
    return rows.map((r) => ({
      name: r.segmentName,
      userCount: r._count._all,
      assignedTo: assignedTo.get(r.segmentName) ?? null,
    }));
  },
  ["segments"],
  { tags: ["segments"], revalidate: TTL.STANDARD }
);

/** Segment definitions (Segment table rows) for the audience builder/sizes pages. */
export const getCachedSegmentDefs = cache(
  unstable_cache(
    () =>
      prisma.segment.findMany({
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, description: true, rule: true, sizeExact: true, sizeComputedAt: true, updatedAt: true },
      }),
    ["segment-defs"],
    { tags: ["segments"], revalidate: TTL.STANDARD }
  )
);

/** All distinct segment names from UserSegment for autocomplete in the rule builder. */
export const getCachedSegmentNames = cache(
  unstable_cache(
    () =>
      prisma.userSegment.findMany({
        distinct: ["segmentName"],
        select: { segmentName: true },
        orderBy: { segmentName: "asc" },
      }),
    ["segment-names"],
    { tags: ["segments"], revalidate: TTL.STANDARD }
  )
);

/** Facet rows for the segment rule builder — changes only when cron refreshes facets. */
export const getCachedSegmentFacets = cache(
  unstable_cache(
    () =>
      prisma.segmentFieldFacet.findMany({
        select: { fieldId: true, kind: true, payload: true },
      }),
    ["segment-facets"],
    { tags: ["segments"], revalidate: TTL.LONG }
  )
);
