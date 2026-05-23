import { NextResponse } from "next/server";
import { createHightouchClient } from "@/lib/hightouch/client";

export async function GET() {
  const client = createHightouchClient();
  if (!client) {
    return NextResponse.json({ data: [] });
  }
  try {
    const models = await client.listModels();
    return NextResponse.json({ data: models });
  } catch (error) {
    console.error("GET /api/hightouch/models error:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
