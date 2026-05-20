import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ externalId: string }> }
) {
  const { externalId } = await params;

  const user = await prisma.trackedUser.findUnique({
    where: { externalId },
    include: { persona: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [recentDecisions, totalDecisions, totalConversions, rewardAgg, armStats] = await Promise.all([
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

  return NextResponse.json({
    data: {
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
    },
  });
}
