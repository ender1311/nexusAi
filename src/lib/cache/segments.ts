/**
 * Segment `unstable_cache` wrappers.
 * See ./index.ts for the tag taxonomy.
 */
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
      prisma.userSegment.groupBy({ by: ["segmentName"], _count: { _all: true }, orderBy: { segmentName: "asc" } }),
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
