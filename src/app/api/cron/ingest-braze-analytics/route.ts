import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { BrazeAnalytics } from "@/lib/braze/analytics";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

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

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000);

  const decisions = await prisma.userDecision.findMany({
    where: {
      brazeSendId: { not: null },
      reward: null,
      conversionAt: null,
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

  // Group decisions by brazeSendId
  const bySendId = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    const sendId = decision.brazeSendId!;
    if (!bySendId.has(sendId)) bySendId.set(sendId, []);
    bySendId.get(sendId)!.push(decision);
  }

  // Batch-fetch TrackedUser personaIds for all userIds across all groups (one query)
  const allUserIds = [...new Set(decisions.map((d) => d.userId))];
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

  for (const [brazeSendId, groupDecisions] of bySendId) {
    const brazeCampaignId = groupDecisions[0].variant?.message?.brazeCampaignId ?? null;
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
    const openRate = analyticsResult.open_rate ?? 0;
    // Map to a fractional reward: clicks are stronger signal than opens
    const analyticsReward = Math.min(0.8, clickRate * 0.6 + openRate * 0.1);

    totalDecisions += groupDecisions.length;

    if (analyticsReward <= 0) continue;

    // Load existing arm stats for all (agentId, variantId, personaId) combos in this group
    const agentVariantPersonaCombos = groupDecisions
      .map((d) => ({
        agentId: d.agentId,
        variantId: d.messageVariantId!,
        personaId: personaByUserId.get(d.userId),
      }))
      .filter((c): c is { agentId: string; variantId: string; personaId: string } =>
        c.personaId !== undefined
      );

    // Deduplicate combos for arm stats lookup
    const uniqueCombos = [
      ...new Map(
        agentVariantPersonaCombos.map((c) => [
          `${c.agentId}|${c.variantId}|${c.personaId}`,
          c,
        ])
      ).values(),
    ];

    if (uniqueCombos.length === 0) continue;

    // Fetch existing arm stats for all unique combos in one query
    const existingStats = await prisma.personaArmStats.findMany({
      where: {
        OR: uniqueCombos.map((c) => ({
          personaId: c.personaId,
          agentId: c.agentId,
          variantId: c.variantId,
        })),
      },
    });

    const statsByKey = new Map(
      existingStats.map((s) => [`${s.agentId}|${s.variantId}|${s.personaId}`, s])
    );

    // Upsert arm stats and update decision rewards in parallel
    await Promise.all(
      agentVariantPersonaCombos.map(async ({ agentId, variantId, personaId }) => {
        const key = `${agentId}|${variantId}|${personaId}`;
        const existing = statsByKey.get(key);

        // Apply temporal decay then reward
        const decayedAlpha = existing ? 1 + (existing.alpha - 1) * 0.99 : 1;
        const decayedBeta = existing ? 1 + (existing.beta - 1) * 0.99 : 30;
        const newAlpha = decayedAlpha + analyticsReward;
        const newBeta = decayedBeta; // no increment — positive signal

        await prisma.personaArmStats.upsert({
          where: { personaId_agentId_variantId: { personaId, agentId, variantId } },
          create: {
            personaId,
            agentId,
            variantId,
            alpha: newAlpha,
            beta: newBeta,
            tries: 1,
            wins: 1,
          },
          update: {
            alpha: newAlpha,
            beta: newBeta,
            tries: { increment: 1 },
            wins: { increment: 1 },
          },
        });
      })
    );

    // Mark each decision in the group as processed
    const decisionIdsToUpdate = groupDecisions
      .filter((d) => personaByUserId.has(d.userId))
      .map((d) => d.id);

    if (decisionIdsToUpdate.length > 0) {
      await prisma.userDecision.updateMany({
        where: { id: { in: decisionIdsToUpdate } },
        data: { reward: analyticsReward },
      });
      totalUpdated += decisionIdsToUpdate.length;
    }
  }

  return NextResponse.json({ ok: true, processed: totalDecisions, updated: totalUpdated });
}
