import { NextResponse } from "next/server";
import { createHightouchClient } from "@/lib/hightouch/client";

export async function GET() {
  const client = createHightouchClient();
  if (!client) {
    return NextResponse.json({ data: [] });
  }
  try {
    const syncs = await client.listSyncs();
    return NextResponse.json({ data: syncs });
  } catch (error) {
    console.error("GET /api/hightouch/syncs error:", error);
    return NextResponse.json({ error: "Failed to fetch syncs" }, { status: 500 });
  }
}
