import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";

type BrazeStats = {
  sends: number;
  directOpens: number;
  totalOpens: number;
  directOpenRate: number;
  totalOpenRate: number;
};

type OpenRatePoint = {
  date: string;
  directOpenRate: number;
  totalOpenRate: number;
};

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
  brazeStats?: BrazeStats;
  series?: OpenRatePoint[];
};

export async function GET(): Promise<
  NextResponse<{ data: PushSummaryData }> | NextResponse<{ error: string }>
> {
  try {
    const campaignId = process.env.BRAZE_NEXUS_CAMPAIGN_ID;

    type BrazeResult = { stats: BrazeStats; series: OpenRatePoint[] } | null;

    async function fetchBrazeStats(): Promise<BrazeResult> {
      if (!campaignId) return null;
      const brazeClient = createBrazeClient();
      if (!brazeClient) return null;
      try {
        const res = await brazeClient.get("/campaigns/data_series", {
          campaign_id: campaignId,
          length: 28,
        });
        if (!res.ok) return null;
        const json = await res.json() as { data?: Array<{ time?: string; messages?: Record<string, unknown[]> }> };
        let sends = 0, directOpens = 0, totalOpens = 0;
        const series: OpenRatePoint[] = [];
        const today = new Date().toISOString().slice(0, 10);
        for (const point of (json.data ?? [])) {
          if (!point.messages) continue;
          let daySends = 0, dayDirect = 0, dayTotal = 0;
          for (const variations of Object.values(point.messages)) {
            if (!Array.isArray(variations)) continue;
            for (const v of variations) {
              const s = v as Record<string, unknown>;
              if (typeof s.sent === "number") daySends += s.sent;
              else if (typeof s.sends === "number") daySends += s.sends;
              if (typeof s.direct_opens === "number") dayDirect += s.direct_opens;
              if (typeof s.total_opens === "number") dayTotal += s.total_opens;
            }
          }
          sends += daySends;
          directOpens += dayDirect;
          totalOpens += dayTotal;
          if (point.time && daySends > 0 && point.time.slice(0, 10) < today) {
            series.push({
              date: point.time.slice(0, 10),
              directOpenRate: parseFloat(((dayDirect / daySends) * 100).toFixed(2)),
              totalOpenRate: parseFloat(((dayTotal / daySends) * 100).toFixed(2)),
            });
          }
        }
        // sort ascending (oldest first) so the chart renders left=oldest, right=newest
        series.sort((a, b) => a.date.localeCompare(b.date));
        return {
          stats: {
            sends,
            directOpens,
            totalOpens,
            directOpenRate: sends > 0 ? parseFloat(((directOpens / sends) * 100).toFixed(2)) : 0,
            totalOpenRate: sends > 0 ? parseFloat(((totalOpens / sends) * 100).toFixed(2)) : 0,
          },
          series,
        };
      } catch {
        return null;
      }
    }

    // Three parallel queries: push sends, push opens, and Braze campaign stats
    const [pushSendRows, pushOpenRows, brazeStats] = await Promise.all([
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { channel: "push", brazeSendId: { not: null }, sentAt: { gte: new Date("2026-05-16") } },
        _count: { id: true },
        _min: { sentAt: true },
      }),
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { channel: "push", pushOpenAt: { not: null }, sentAt: { gte: new Date("2026-05-16") } },
        _count: { id: true },
      }),
      fetchBrazeStats(),
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
          brazeStats: brazeStats?.stats ?? undefined,
          series: brazeStats?.series ?? undefined,
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
        brazeStats: brazeStats?.stats ?? undefined,
        series: brazeStats?.series ?? undefined,
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
