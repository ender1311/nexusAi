import { NextResponse } from "next/server";
import { createHightouchClient } from "@/lib/hightouch/client";

export async function GET() {
  const client = createHightouchClient();
  if (!client) {
    return NextResponse.json({ data: [] });
  }
  try {
    const sources = await client.listSources();
    return NextResponse.json({ data: sources });
  } catch (error) {
    console.error("GET /api/hightouch/sources error:", error);
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }
}
