import { NextRequest, NextResponse } from "next/server";
import { decideForUser, type DecideContext } from "@/lib/decide";
import { verifyIngestAuth } from "@/lib/ingest-auth";

function verifyAuth(req: NextRequest): boolean {
  return verifyIngestAuth(req.headers);
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

  const { agentId, externalUserId, context } = (body ?? {}) as Record<string, unknown>;
  if (typeof agentId !== "string" || typeof externalUserId !== "string") {
    return NextResponse.json(
      { error: "agentId and externalUserId are required strings" },
      { status: 400 }
    );
  }

  // context is optional; pass through as-is if it's a plain object
  const decideContext = context !== null && typeof context === "object" && !Array.isArray(context)
    ? (context as DecideContext)
    : undefined;

  const result = await decideForUser({ agentId, externalUserId, context: decideContext });
  if (!result) {
    return NextResponse.json(
      { error: "Agent not found, inactive, or has no active variants" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: result });
}
