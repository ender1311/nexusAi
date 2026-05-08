import { NextRequest, NextResponse } from "next/server";
import { discoverPersonas } from "@/lib/engine/persona-discovery";
import { batchAssignPersonas } from "@/lib/engine/persona-assignment";

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token === secret;
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Run persona discovery
  const discoveryResult = await discoverPersonas();

  // Reassign all users to nearest persona
  const usersReassigned = await batchAssignPersonas();

  console.log(
    `[cron/discover-personas] personasCreated=${discoveryResult.personasCreated} personasUpdated=${discoveryResult.personasUpdated} usersReassigned=${usersReassigned} silhouetteScore=${discoveryResult.silhouetteScore.toFixed(3)} k=${discoveryResult.k}`
  );

  return NextResponse.json({
    ok: true,
    ...discoveryResult,
    usersReassigned,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
