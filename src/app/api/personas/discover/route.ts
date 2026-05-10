import { NextRequest, NextResponse } from "next/server";
import { discoverPersonas } from "@/lib/engine/persona-discovery";
import { batchAssignPersonas } from "@/lib/engine/persona-assignment";

/**
 * POST /api/personas/discover
 *
 * Triggers the persona discovery pipeline:
 * 1. Cluster users with enough behavioral data (k-means)
 * 2. Create/update discovered Persona records
 * 3. Assign users to personas based on cosine similarity
 */
export async function POST(req: NextRequest) {
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

  return NextResponse.json({
    ok: true,
    ...discoveryResult,
    usersAssigned: assigned,
  });
}
