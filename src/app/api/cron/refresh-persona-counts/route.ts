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

// Both groupBys are full-table scans over ~39M User rows (~120s each on Neon).
// 60s wasn't enough — this cron was silently timing out, leaving userCount at 0.
// Run them in parallel and give the run headroom.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One GROUP BY across the full User table instead of N separate COUNT(*) queries.
  // Persona counts + the funnel-stage breakdown both scan the full table, so run
  // them in parallel. The funnel snapshot is read by getCachedFunnelStageBreakdown
  // (a live GROUP BY there is too slow for a page/4h cache to recompute on demand).
  const [counts, funnelRows] = await Promise.all([
    prisma.$queryRaw<Array<{ personaId: string; count: number }>>`
      SELECT "personaId", COUNT(*)::int AS count
      FROM "User"
      WHERE "personaId" IS NOT NULL
      GROUP BY "personaId"
    `,
    prisma.$queryRaw<Array<{ funnelStage: string | null; count: bigint }>>`
      SELECT "funnelStage", COUNT(*)::bigint AS count
      FROM "User"
      GROUP BY "funnelStage"
    `,
  ]);

  const countMap = new Map(counts.map((r) => [r.personaId, r.count]));

  const personas = await prisma.persona.findMany({ select: { id: true } });

  const funnelBreakdown = funnelRows
    .map((r) => ({ stage: r.funnelStage ?? "unknown", count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);

  await Promise.all([
    ...personas.map((p) =>
      prisma.persona.update({
        where: { id: p.id },
        data: { userCount: countMap.get(p.id) ?? 0 },
      })
    ),
    prisma.appSetting.upsert({
      where: { key: "funnel_stage_breakdown" },
      create: { key: "funnel_stage_breakdown", value: JSON.stringify(funnelBreakdown) },
      update: { value: JSON.stringify(funnelBreakdown) },
    }),
  ]);

  revalidateTag("personas", "max");
  revalidateTag("funnel-breakdown", "max");

  return NextResponse.json({ updated: personas.length, funnelStages: funnelBreakdown.length });
}
