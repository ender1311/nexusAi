import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { BrazeAnalytics } from "@/lib/braze/analytics";
import { batchUpsertArmStats, batchUpsertUserArmStats } from "@/lib/arm-stats";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

// ── Short-term analytics budget ───────────────────────────────────────────────
// Until Hightouch or another source provides campaign analytics at scale,
// we pull per-send stats from Braze /sends/data_series. Braze retains this
// data for 14 days and the API allows 250k req/hour, but we self-impose a
// conservative daily cap to avoid burning through send_id registrations.
// TODO: replace with Hightouch campaign analytics when available.
const DAILY_SEND_ID_LIMIT = 900;

// Reward weights: click = success signal, open-only or no-engage = punish
// click_rate from BrazeAnalytics.normalizeMetrics() is 0–100 (percentage).
// Scale: 20% CTR → max reward (0.8). Formula: min(0.8, click_rate_pct × 0.04)
const CLICK_REWARD_SCALE = 0.04;     // click_rate_pct × scale, capped at CLICK_REWARD_MAX
const CLICK_REWARD_MAX   = 0.8;
const OPEN_NO_CLICK_PENALTY = 0.15;  // saw it but didn't act — mild negative signal
const NO_ENGAGE_PENALTY     = 0.35;  // didn't open at all — stronger negative signal

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token === secret;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const brazeClient = createBrazeClient();
  if (!brazeClient) {
    return NextResponse.json({ ok: true, processed: 0, skipped: "Braze not configured" });
  }

  // ── Daily budget check ────────────────────────────────────────────────────
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const fetchedTodayRows = await prisma.userDecision.findMany({
    where: { brazeAnalyticsFetchedAt: { gte: startOfDay }, brazeSendId: { not: null } },
    select: { brazeSendId: true },
    distinct: ["brazeSendId"],
  });
  const usedBudget = fetchedTodayRows.length;
  const remainingBudget = DAILY_SEND_ID_LIMIT - usedBudget;

  if (remainingBudget <= 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      skipped: "daily_send_id_limit_reached",
      limit: DAILY_SEND_ID_LIMIT,
      used: usedBudget,
    });
  }

  // ── Fetch decisions eligible for analytics ────────────────────────────────
  // Window: sent 24–72h ago, no reward set yet (not already handled by events ingest)
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000);

  const decisions = await prisma.userDecision.findMany({
    where: {
      brazeSendId: { not: null },
      reward: null,
      conversionAt: null,
      brazeAnalyticsFetchedAt: null,
      sentAt: { gte: cutoff72h, lte: cutoff24h },
      messageVariantId: { not: null },
    },
    include: {
      variant: {
        include: {
          message: { select: { brazeCampaignId: true } },
        },
      },
    },
  });

  if (decisions.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Group by brazeSendId
  const bySendId = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    const sendId = decision.brazeSendId!;
    if (!bySendId.has(sendId)) bySendId.set(sendId, []);
    bySendId.get(sendId)!.push(decision);
  }

  // Apply daily budget cap
  const sendIdsToProcess = [...bySendId.keys()].slice(0, remainingBudget);

  // Batch-fetch TrackedUser personaIds for all users in scope (one query)
  const allUserIds = [
    ...new Set(
      sendIdsToProcess.flatMap((sid) => bySendId.get(sid)!.map((d) => d.userId))
    ),
  ];
  const trackedUsers = await prisma.trackedUser.findMany({
    where: { externalId: { in: allUserIds } },
    select: { externalId: true, personaId: true },
  });
  const personaByUserId = new Map<string, string>(
    trackedUsers
      .filter((u): u is { externalId: string; personaId: string } => u.personaId !== null)
      .map((u) => [u.externalId, u.personaId])
  );

  const analyticsClient = new BrazeAnalytics(brazeClient);
  let totalDecisions = 0;
  let totalUpdated = 0;
  const now = new Date();

  for (const brazeSendId of sendIdsToProcess) {
    const groupDecisions = bySendId.get(brazeSendId)!;
    // Prefer the per-message brazeCampaignId; fall back to the global env var because
    // most production Message records were created before the field was populated.
    const brazeCampaignId =
      groupDecisions[0].variant?.message?.brazeCampaignId ??
      process.env.BRAZE_NEXUS_CAMPAIGN_ID ??
      null;
    if (!brazeCampaignId) continue;

    let analyticsResult: Record<string, number> | null;
    try {
      analyticsResult = await analyticsClient.fetchSendAnalytics(brazeCampaignId, brazeSendId);
    } catch (err) {
      console.error("[cron/ingest-braze-analytics] fetchSendAnalytics error:", err);
      continue;
    }

    if (!analyticsResult) continue;

    const clickRate = analyticsResult.click_rate ?? 0;
    const openRate  = analyticsResult.open_rate  ?? 0;

    // ── Click-based reward / punishment ───────────────────────────────────
    // Reward: user clicked → positive signal for Thompson arm
    // Punish: user ignored (opened but no click) or didn't open at all
    let reward: number;
    let deltaAlpha: number;
    let deltaBeta: number;

    if (clickRate > 0) {
      reward     = Math.min(CLICK_REWARD_MAX, clickRate * CLICK_REWARD_SCALE);
      deltaAlpha = reward;
      deltaBeta  = 0;
    } else if (openRate > 0) {
      // Opened but didn't click — mild punishment
      reward     = -OPEN_NO_CLICK_PENALTY;
      deltaAlpha = 0;
      deltaBeta  = OPEN_NO_CLICK_PENALTY;
    } else {
      // No engagement at all — stronger punishment
      reward     = -NO_ENGAGE_PENALTY;
      deltaAlpha = 0;
      deltaBeta  = NO_ENGAGE_PENALTY;
    }

    totalDecisions += groupDecisions.length;

    const agentVariantPersonaCombos = groupDecisions
      .map((d) => ({
        agentId:   d.agentId,
        variantId: d.messageVariantId!,
        personaId: personaByUserId.get(d.userId),
      }))
      .filter((c): c is { agentId: string; variantId: string; personaId: string } =>
        c.personaId !== undefined
      );

    const uniqueCombos = [
      ...new Map(
        agentVariantPersonaCombos.map((c) => [
          `${c.agentId}|${c.variantId}|${c.personaId}`,
          c,
        ])
      ).values(),
    ];

    // Apply decay + reward/punishment in parallel batches.
    // All combos within a sendId share the same delta values (same analytics result).
    const deltaWins = clickRate > 0 ? 1 : 0;
    const delta = { deltaAlpha, deltaBeta, deltaWins };
    try {
      await Promise.all([
        // Persona-level: one upsert per unique (persona, agent, variant) combo
        batchUpsertArmStats(
          uniqueCombos.map(({ agentId, variantId, personaId }) => ({ personaId, agentId, variantId })),
          delta,
        ),
        // User-level: one upsert per individual decision (each user gets their own row)
        batchUpsertUserArmStats(
          groupDecisions
            .filter((d) => d.messageVariantId !== null)
            .map((d) => ({ userId: d.userId, agentId: d.agentId, variantId: d.messageVariantId! })),
          delta,
        ),
      ]);
    } catch (err) {
      console.error(`[cron/ingest-braze-analytics] arm stats update failed for sendId=${brazeSendId}:`, err);
      continue;
    }

    // Mark decisions as processed: set reward + brazeAnalyticsFetchedAt.
    // Include ALL decisions in the group — persona-less users still get their
    // user-level arm stats updated above and must be marked to prevent
    // repeated reprocessing on every cron run (which inflates arm stats).
    const decisionIdsToUpdate = groupDecisions
      .map((d) => d.id);

    if (decisionIdsToUpdate.length > 0) {
      await prisma.userDecision.updateMany({
        where: { id: { in: decisionIdsToUpdate } },
        data: { reward, brazeAnalyticsFetchedAt: now },
      });
      totalUpdated += decisionIdsToUpdate.length;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: totalDecisions,
    updated: totalUpdated,
    sendIds: sendIdsToProcess.length,
    budgetUsed: usedBudget + sendIdsToProcess.length,
    budgetRemaining: remainingBudget - sendIdsToProcess.length,
    budgetLimit: DAILY_SEND_ID_LIMIT,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
