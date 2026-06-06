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

  // Optional { full_resync }: a full resync re-syncs every row instead of the
  // incremental diff. Absent/invalid body defaults to an incremental run.
  let fullResync = false;
  try {
    const body: unknown = await request.json();
    if (
      typeof body === "object" && body !== null &&
      typeof (body as Record<string, unknown>).full_resync === "boolean"
    ) {
      fullResync = (body as Record<string, boolean>).full_resync;
    }
  } catch {
    // no/invalid JSON body — keep incremental default
  }

  try {
    const result = await client.triggerSync(id, fullResync);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error(`POST /api/hightouch/syncs/${id}/trigger error:`, error);
    return NextResponse.json({ error: "Failed to trigger sync" }, { status: 500 });
  }
}
