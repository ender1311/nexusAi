import { NextResponse } from "next/server";
import { createHightouchClient } from "@/lib/hightouch/client";

export async function GET() {
  const client = createHightouchClient();
  if (!client) {
    return NextResponse.json({ data: [] });
  }
  try {
    const destinations = await client.listDestinations();
    return NextResponse.json({ data: destinations });
  } catch (error) {
    console.error("GET /api/hightouch/destinations error:", error);
    return NextResponse.json({ error: "Failed to fetch destinations" }, { status: 500 });
  }
}
