import { NextRequest, NextResponse } from "next/server";
import { createHightouchClient } from "@/lib/hightouch/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = createHightouchClient();
  if (!client) {
    return NextResponse.json({ data: [] });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 20;
  if (isNaN(limit) || limit < 1) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  try {
    const runs = await client.getSyncRuns(id, limit);
    return NextResponse.json({ data: runs });
  } catch (error) {
    console.error(`GET /api/hightouch/syncs/${id}/runs error:`, error);
    return NextResponse.json({ error: "Failed to fetch sync runs" }, { status: 500 });
  }
}
