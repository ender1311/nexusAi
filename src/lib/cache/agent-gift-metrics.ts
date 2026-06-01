import { prisma } from "@/lib/db";

export type AgentGiftMetrics = {
  giftCount: number;
  giftRevenue: number;
  giftConversionRate: number; // gifts ÷ sends, percent
  avgTimeToGiftHours: number;
};

/**
 * Per-agent gift metrics over the last 30 days: attributed gift count,
 * USD revenue (SUM of conversionValue), conversion rate (gifts ÷ sends), and
 * average time-to-gift in hours (AVG(conversionAt - sentAt) for gift_given).
 */
export async function agentGiftMetrics(agentId: string): Promise<AgentGiftMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<[{
    sends: bigint;
    gift_count: bigint;
    gift_revenue: number | null;
    avg_time_to_gift_seconds: number | null;
  }]>`
    SELECT
      COUNT(*)::bigint                                                                            AS sends,
      COUNT(*) FILTER (WHERE "conversionEvent" = 'gift_given')::bigint                            AS gift_count,
      COALESCE(SUM("conversionValue") FILTER (WHERE "conversionEvent" = 'gift_given'), 0)::float  AS gift_revenue,
      AVG(EXTRACT(EPOCH FROM ("conversionAt" - "sentAt"))) FILTER (WHERE "conversionEvent" = 'gift_given') AS avg_time_to_gift_seconds
    FROM "UserDecision"
    WHERE "agentId" = ${agentId}
      AND "sentAt" >= ${thirtyDaysAgo}
  `;
  const r = rows[0];
  const sends = Number(r?.sends ?? 0);
  const giftCount = Number(r?.gift_count ?? 0);
  return {
    giftCount,
    giftRevenue: Number(r?.gift_revenue ?? 0),
    giftConversionRate: sends > 0 ? (giftCount / sends) * 100 : 0,
    avgTimeToGiftHours: r?.avg_time_to_gift_seconds ? Number(r.avg_time_to_gift_seconds) / 3600 : 0,
  };
}
