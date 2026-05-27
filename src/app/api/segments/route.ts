import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type SegmentInfo = { name: string; assignedTo: string | null };

export async function GET(): Promise<NextResponse<{ data: SegmentInfo[] }>> {
  const [rows, agents] = await Promise.all([
    prisma.userSegment.groupBy({ by: ["segmentName"], orderBy: { segmentName: "asc" } }),
    prisma.agent.findMany({
      where: { targetSegmentName: { not: null } },
      select: { targetSegmentName: true, name: true },
    }),
  ]);

  const assignedTo = new Map(agents.map((a) => [a.targetSegmentName!, a.name]));
  return NextResponse.json({
    data: rows.map((r) => ({ name: r.segmentName, assignedTo: assignedTo.get(r.segmentName) ?? null })),
  });
}
