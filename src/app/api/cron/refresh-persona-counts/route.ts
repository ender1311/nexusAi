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
  const [counts, funnelRows, channelRows] = await Promise.all([
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
    // Preferred-channel distribution — an unfiltered COUNT FILTER over the full
    // User table (~144s) that no index can speed up. Snapshot it here so
    // getCachedPreferredChannelStats reads instantly instead of scanning on a cold cache.
    prisma.$queryRaw<[{
      total: bigint; ext_push: bigint; ext_email: bigint;
      ov_push: bigint; ov_email: bigint; ov_inapp: bigint; ov_cc: bigint;
    }]>`
      SELECT
        COUNT(*)::bigint                                                                                       AS total,
        COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_external_90_days' = 'push_notification')::bigint AS ext_push,
        COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_external_90_days' = 'email')::bigint             AS ext_email,
        COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'push_notification')::bigint  AS ov_push,
        COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'email')::bigint              AS ov_email,
        COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'in_app_message')::bigint     AS ov_inapp,
        COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'content_card')::bigint       AS ov_cc
      FROM "User"
    `,
  ]);

  const countMap = new Map(counts.map((r) => [r.personaId, r.count]));

  const personas = await prisma.persona.findMany({ select: { id: true } });

  const funnelBreakdown = funnelRows
    .map((r) => ({ stage: r.funnelStage ?? "unknown", count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);

  const c = channelRows[0];
  const channelStats = {
    total: Number(c.total),
    external: {
      push_notification: Number(c.ext_push),
      email: Number(c.ext_email),
    },
    overall: {
      push_notification: Number(c.ov_push),
      email: Number(c.ov_email),
      in_app_message: Number(c.ov_inapp),
      content_card: Number(c.ov_cc),
    },
  };

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
    prisma.appSetting.upsert({
      where: { key: "preferred_channel_stats" },
      create: { key: "preferred_channel_stats", value: JSON.stringify(channelStats) },
      update: { value: JSON.stringify(channelStats) },
    }),
    // channelStats.total is COUNT(*) over the full User table — i.e. the tracked-user
    // count. Reuse it so getCachedTrackedUserCount avoids its own ~120s COUNT scan.
    prisma.appSetting.upsert({
      where: { key: "tracked_user_count" },
      create: { key: "tracked_user_count", value: String(channelStats.total) },
      update: { value: String(channelStats.total) },
    }),
  ]);

  revalidateTag("personas", "max");
  revalidateTag("funnel-breakdown", "max");
  revalidateTag("user-count", "max");

  return NextResponse.json({ updated: personas.length, funnelStages: funnelBreakdown.length });
}
