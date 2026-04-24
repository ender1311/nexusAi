import { NextRequest, NextResponse } from "next/server";
import { decideForUser } from "@/lib/decide";

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return true;
  return token === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { agentId, externalUserId } = (body ?? {}) as Record<string, unknown>;
  if (typeof agentId !== "string" || typeof externalUserId !== "string") {
    return NextResponse.json(
      { error: "agentId and externalUserId are required strings" },
      { status: 400 }
    );
  }

  const result = await decideForUser({ agentId, externalUserId });
  if (!result) {
    return NextResponse.json(
      { error: "Agent not found, inactive, or has no active variants" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: result });
}
