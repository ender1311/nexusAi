import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ externalId: string }> }
) {
  const { externalId } = await params;

  try {
    const user = await prisma.trackedUser.findUnique({
      where: { externalId },
      include: { persona: true },
    });

    if (!user) {
      return fail("User not found", 404);
    }

    const [recentDecisions, totalDecisions, totalConversions, rewardAgg, armStats, giftAgg, mostRecentGift] = await Promise.all([
      prisma.userDecision.findMany({
        where: { userId: externalId },
        orderBy: { sentAt: "desc" },
        take: 10,
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              title: true,
              body: true,
              message: { select: { channel: true, agent: { select: { id: true, name: true } } } },
            },
          },
        },
      }),
      prisma.userDecision.count({ where: { userId: externalId } }),
      prisma.userDecision.count({ where: { userId: externalId, conversionAt: { not: null } } }),
      prisma.userDecision.aggregate({ where: { userId: externalId }, _sum: { reward: true } }),
      user.personaId
        ? prisma.personaArmStats.findMany({
            where: { personaId: user.personaId },
            orderBy: { tries: "desc" },
            take: 20,
          })
        : Promise.resolve([]),
      prisma.userDecision.aggregate({
        where: { userId: externalId, conversionEvent: "gift_given" },
        _count: { _all: true },
        _sum: { conversionValue: true },
      }),
      prisma.userDecision.findFirst({
        where: { userId: externalId, conversionEvent: "gift_given", conversionAt: { not: null } },
        orderBy: { conversionAt: "desc" },
        select: {
          sentAt: true,
          conversionAt: true,
          conversionValue: true,
          agent: { select: { name: true } },
        },
      }),
    ]);

    // Enrich arm stats with variant + agent names
    const variantIds = [...new Set(armStats.map((s) => s.variantId))];
    const variants =
      variantIds.length > 0
        ? await prisma.messageVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              name: true,
              title: true,
              body: true,
              message: { select: { channel: true, agent: { select: { id: true, name: true } } } },
            },
          })
        : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const enrichedArmStats = armStats.map((s) => ({
      ...s,
      variant: variantMap.get(s.variantId) ?? null,
      expectedReward: s.alpha / Math.max(1, s.alpha + s.beta),
    }));

    const mostRecent = mostRecentGift && mostRecentGift.conversionAt
      ? {
          usd: mostRecentGift.conversionValue ?? 0,
          agentName: mostRecentGift.agent?.name ?? null,
          timeToGiftHours: (mostRecentGift.conversionAt.getTime() - mostRecentGift.sentAt.getTime()) / 3_600_000,
          conversionAt: mostRecentGift.conversionAt.toISOString(),
        }
      : null;

    return ok({
      user: {
        externalId: user.externalId,
        personaId: user.personaId,
        personaName: user.persona?.name ?? null,
        personaConfidence: user.personaConfidence,
        totalDecisions,
        totalConversions,
        totalReward: rewardAgg._sum.reward ?? 0,
      },
      recentDecisions,
      armStats: enrichedArmStats,
      gifts: {
        count: giftAgg._count._all,
        totalUsd: giftAgg._sum.conversionValue ?? 0,
        mostRecent,
      },
    });
  } catch (err) {
    return handleRouteError(`GET /api/users/${externalId}`, err);
  }
}
