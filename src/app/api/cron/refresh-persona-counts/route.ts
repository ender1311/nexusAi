import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";

function isAuthorized(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token != null && constantTimeEqual(token, secret);
}

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One GROUP BY across the full User table instead of N separate COUNT(*) queries.
  // Reading all persona→user assignments in a single pass avoids N×35M row scans.
  const counts = await prisma.$queryRaw<Array<{ personaId: string; count: number }>>`
    SELECT "personaId", COUNT(*)::int AS count
    FROM "User"
    WHERE "personaId" IS NOT NULL
    GROUP BY "personaId"
  `;

  const countMap = new Map(counts.map((r) => [r.personaId, r.count]));

  const personas = await prisma.persona.findMany({ select: { id: true } });

  await Promise.all(
    personas.map((p) =>
      prisma.persona.update({
        where: { id: p.id },
        data: { userCount: countMap.get(p.id) ?? 0 },
      })
    )
  );

  revalidateTag("personas", "max");

  return NextResponse.json({ updated: personas.length, counts: Object.fromEntries(countMap) });
}
