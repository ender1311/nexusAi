import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type PushSummaryData = {
  totalPushSends: number;
  totalPushOpens: number;
  openRate: number;
  firstPushAt: string | null;
  agentCount: number;
  byAgent: Array<{
    agentId: string;
    agentName: string;
    pushSends: number;
    pushOpens: number;
    openRate: number;
    firstPushAt: string;
  }>;
};

export async function GET(): Promise<
  NextResponse<{ data: PushSummaryData }> | NextResponse<{ error: string }>
> {
  try {
    // Two parallel groupBy queries for push sends and push opens
    const [pushSendRows, pushOpenRows] = await Promise.all([
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { channel: "push" },
        _count: { id: true },
        _min: { sentAt: true },
      }),
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { channel: "push", pushOpenAt: { not: null } },
        _count: { id: true },
      }),
    ]);

    // If no push data, return empty summary
    if (pushSendRows.length === 0) {
      return NextResponse.json({
        data: {
          totalPushSends: 0,
          totalPushOpens: 0,
          openRate: 0,
          firstPushAt: null,
          agentCount: 0,
          byAgent: [],
        },
      });
    }

    // Fetch agent names for all relevant agent IDs
    const agentIds = pushSendRows.map((r) => r.agentId);
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

    // Build lookup for opens by agentId
    const opensByAgentId = new Map(
      pushOpenRows.map((r) => [r.agentId, r._count.id])
    );

    // Compute per-agent rows, sorted by sends desc
    const byAgent = pushSendRows
      .map((r) => {
        const sends = r._count.id;
        const opens = opensByAgentId.get(r.agentId) ?? 0;
        return {
          agentId: r.agentId,
          agentName: agentNameById.get(r.agentId) ?? r.agentId,
          pushSends: sends,
          pushOpens: opens,
          openRate: sends > 0 ? (opens / sends) * 100 : 0,
          firstPushAt: r._min.sentAt!.toISOString(),
        };
      })
      .sort((a, b) => b.pushSends - a.pushSends);

    // Fleet totals derived from per-agent data
    const totalPushSends = byAgent.reduce((s, r) => s + r.pushSends, 0);
    const totalPushOpens = byAgent.reduce((s, r) => s + r.pushOpens, 0);
    const openRate =
      totalPushSends > 0 ? (totalPushOpens / totalPushSends) * 100 : 0;
    const allFirstPushDates = byAgent
      .map((r) => r.firstPushAt)
      .sort();
    const firstPushAt = allFirstPushDates[0] ?? null;

    return NextResponse.json({
      data: {
        totalPushSends,
        totalPushOpens,
        openRate,
        firstPushAt,
        agentCount: byAgent.length,
        byAgent,
      },
    });
  } catch (error) {
    console.error("GET /api/metrics/push-summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch push summary" },
      { status: 500 }
    );
  }
}
