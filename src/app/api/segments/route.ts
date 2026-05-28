import { NextResponse } from "next/server";
import { getCachedSegments, type SegmentInfo } from "@/lib/cache";

export async function GET(): Promise<NextResponse<{ data: SegmentInfo[] }>> {
  const data = await getCachedSegments();
  return NextResponse.json({ data });
}
