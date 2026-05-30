import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { discoverPersonas, batchAssignPersonas } from "@/lib/services/persona-service";
import { requireAdmin } from "@/lib/auth";

/**
 * POST /api/personas/discover
 *
 * Triggers the persona discovery pipeline:
 * 1. Cluster users with enough behavioral data (k-means)
 * 2. Create/update discovered Persona records
 * 3. Assign users to personas based on cosine similarity
 */
export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  let config: {
    minInteractions?: number;
    minK?: number;
    maxK?: number;
  } = {};

  try {
    const body = await req.json();
    config = body ?? {};
  } catch {
    // No body is fine
  }

  const discoveryResult = await discoverPersonas({
    minInteractions: config.minInteractions,
    minK: config.minK,
    maxK: config.maxK,
  });

  if (discoveryResult.k === 0) {
    return NextResponse.json({
      ok: false,
      message: "Not enough users with sufficient data to run discovery.",
      minInteractionsRequired: config.minInteractions ?? 20,
      eligibleUsers: discoveryResult.usersAssigned,
    });
  }

  const assigned = await batchAssignPersonas({
    minInteractions: config.minInteractions ?? 20,
  });

  revalidateTag("personas", "max");

  return NextResponse.json({
    ok: true,
    ...discoveryResult,
    usersAssigned: assigned,
  });
}
