import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type StatsData = {
  trackedUsers: number;
  personas: number;
  agents: number;
  totalDecisions: number;
  totalConversions: number;
};

export async function GET(): Promise<NextResponse<StatsData | { error: string }>> {
  try {
    const [trackedUsers, personas, agents, decisions, totalConversions] = await Promise.all([
      prisma.trackedUser.count(),
      prisma.persona.count({ where: { isActive: true } }),
      prisma.agent.count({ where: { status: "active" } }),
      prisma.userDecision.aggregate({
        _count: { id: true },
        _sum: { reward: true },
        where: {},
      }),
      prisma.userDecision.count({ where: { conversionAt: { not: null } } }),
    ]);

    const res = NextResponse.json({
      trackedUsers,
      personas,
      agents,
      totalDecisions: decisions._count.id,
      totalConversions,
    });
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res;
  } catch {
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
