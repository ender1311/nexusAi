import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(): Promise<NextResponse<{ data: string[] }>> {
  const rows = await prisma.userSegment.groupBy({
    by: ["segmentName"],
    orderBy: { segmentName: "asc" },
  });
  return NextResponse.json({ data: rows.map((r) => r.segmentName) });
}
