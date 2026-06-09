import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";
import { batchUpsertArmStats, batchUpsertUserArmStats } from "@/lib/arm-stats";
import { getCachedDashboardCounts, getCachedPerformanceMetrics, getCachedVariantMetrics } from "@/lib/cache";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

// ── 48-hour time-decay cron ───────────────────────────────────────────────────
// Replaces the old Braze /sends/data_series pull with a purely DB-based decay.
//
// After 48h, any unresolved decision (brazeAnalyticsFetchedAt=null) gets
// processed based on whether Hightouch Currents delivered a push open:
//
//   pushOpenAt IS set → mark processed, no arm stats change.
//     Canvas-attributed opens already credited +1 alpha via /api/ingest/users.
//     Time-window opens intentionally skip arm stats (imprecise match).
//
//   pushOpenAt IS null → no engagement confirmed; apply NO_ENGAGE_PENALTY to
//     arm stats (deltaBeta += 0.35) and stamp brazeAnalyticsFetchedAt.
//
// Push opens arrive via /api/ingest/users (Hightouch Currents push_open_rows).
// No Braze API calls are made by this cron.

const NO_ENGAGE_PENALTY = 0.35;
const DECAY_WINDOW_MS   = 48 * 60 * 60 * 1000;
const BATCH_SIZE        = 500;

function verifyAuth(req: NextRequest): boolean {
  const token  = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token != null && constantTimeEqual(token, secret);
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - DECAY_WINDOW_MS);

  const decisions = await prisma.userDecision.findMany({
    where: {
      brazeSendId:           { not: null },
      brazeAnalyticsFetchedAt: null,
      sentAt:                { lte: cutoff },
    },
    select: {
      id:               true,
      userId:           true,
      agentId:          true,
      messageVariantId: true,
      pushOpenAt:       true,
    },
    take: BATCH_SIZE,
  });

  if (decisions.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const opens      = decisions.filter((d) => d.pushOpenAt !== null);
  const noEngage   = decisions.filter((d) => d.pushOpenAt === null);
  const now        = new Date();

  // Mark opened decisions processed — positive arm stats credit already
  // applied by canvas attribution in /api/ingest/users.
  if (opens.length > 0) {
    await prisma.userDecision.updateMany({
      where: { id: { in: opens.map((d) => d.id) } },
      data:  { reward: 0, brazeAnalyticsFetchedAt: now },
    });
  }

  // Apply no-engagement penalty and mark processed.
  if (noEngage.length > 0) {
    const userIds = [...new Set(noEngage.map((d) => d.userId))];
    const trackedUsers = await prisma.trackedUser.findMany({
      where:  { externalId: { in: userIds } },
      select: { externalId: true, personaId: true },
    });
    const personaByUserId = new Map<string, string>(
      trackedUsers
        .filter((u): u is { externalId: string; personaId: string } => u.personaId !== null)
        .map((u) => [u.externalId, u.personaId]),
    );

    const delta = { deltaAlpha: 0, deltaBeta: NO_ENGAGE_PENALTY, deltaWins: 0 };

    const personaCombos = [
      ...new Map(
        noEngage
          .filter((d) => d.messageVariantId && personaByUserId.has(d.userId))
          .map((d) => {
            const personaId = personaByUserId.get(d.userId)!;
            return [
              `${d.agentId}|${d.messageVariantId}|${personaId}`,
              { agentId: d.agentId, variantId: d.messageVariantId!, personaId },
            ] as const;
          }),
      ).values(),
    ];

    const userCombos = noEngage
      .filter((d) => d.messageVariantId !== null)
      .map((d) => ({ userId: d.userId, agentId: d.agentId, variantId: d.messageVariantId! }));

    try {
      await Promise.all([
        batchUpsertArmStats(personaCombos, delta),
        batchUpsertUserArmStats(userCombos, delta),
      ]);
    } catch (err) {
      console.error("[cron/ingest-braze-analytics] arm stats update failed:", err);
      // Continue to stamp decisions even if arm stats fail — prevents infinite reprocessing
    }

    await prisma.userDecision.updateMany({
      where: { id: { in: noEngage.map((d) => d.id) } },
      data:  { reward: -NO_ENGAGE_PENALTY, brazeAnalyticsFetchedAt: now },
    });
  }

  // Bust caches that depend on arm stats / reward data and warm them
  // immediately so the next page load gets a cache hit instead of a cold query.
  revalidateTag("dashboard-stats", "max");
  revalidateTag("performance", "max");
  revalidateTag("braze-stats", "max");
  void Promise.all([
    getCachedDashboardCounts(),
    getCachedPerformanceMetrics(),
    getCachedVariantMetrics(),
  ]).catch(() => {});

  return NextResponse.json({
    ok:        true,
    processed: decisions.length,
    opens:     opens.length,
    penalized: noEngage.length,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
