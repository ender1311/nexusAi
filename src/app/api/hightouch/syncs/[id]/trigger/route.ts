import { NextRequest, NextResponse } from "next/server";
import { createHightouchClient } from "@/lib/hightouch/client";
import { requireAdmin } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const client = createHightouchClient();
  if (!client) {
    return NextResponse.json({ error: "Hightouch not configured" }, { status: 503 });
  }

  const { id } = await params;

  let fullResync = false;
  try {
    const body = await request.json();
    fullResync = body.full_resync === true;
  } catch {
    // body is optional
  }

  try {
    const result = await client.triggerSync(id, fullResync);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error(`POST /api/hightouch/syncs/${id}/trigger error:`, error);
    return NextResponse.json({ error: "Failed to trigger sync" }, { status: 500 });
  }
}
