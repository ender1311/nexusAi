import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { discoverPersonas, batchAssignPersonas } from "@/lib/services/persona-service";

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

  revalidateTag("personas", "max");

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
