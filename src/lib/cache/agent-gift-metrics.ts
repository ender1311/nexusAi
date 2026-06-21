import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";

export type AgentGiftMetrics = {
  giftCount: number;
  giftRevenue: number;
  giftConversionRate: number; // gifts ÷ sends, percent
  avgTimeToGiftHours: number;
  sowerCount: number; // attributed sower_subscribed conversions
  sowerConversionRate: number; // sowers ÷ sends, percent
};

/**
 * Per-agent gift metrics over the last 30 days: attributed gift count,
 * USD revenue (SUM of conversionValue), conversion rate (gifts ÷ sends),
 * average time-to-gift in hours (AVG(conversionAt - sentAt) for gift_given), and
 * recurring-giver (Sower) conversions: sower_subscribed count and rate (÷ sends).
 */
async function queryAgentGiftMetrics(agentId: string): Promise<AgentGiftMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<[{
    sends: bigint;
    gift_count: bigint;
    gift_revenue: number | null;
    avg_time_to_gift_seconds: number | null;
    sower_count: bigint;
  }]>`
    SELECT
      COUNT(*)::bigint                                                                            AS sends,
      COUNT(*) FILTER (WHERE "conversionEvent" = 'gift_given')::bigint                            AS gift_count,
      COALESCE(SUM("conversionValue") FILTER (WHERE "conversionEvent" = 'gift_given'), 0)::float  AS gift_revenue,
      AVG(EXTRACT(EPOCH FROM ("conversionAt" - "sentAt"))) FILTER (WHERE "conversionEvent" = 'gift_given') AS avg_time_to_gift_seconds,
      COUNT(*) FILTER (WHERE "conversionEvent" = 'sower_subscribed')::bigint                      AS sower_count
    FROM "UserDecision"
    WHERE "agentId" = ${agentId}
      AND "sentAt" >= ${thirtyDaysAgo}
  `;
  const r = rows[0];
  const sends = Number(r?.sends ?? 0);
  const giftCount = Number(r?.gift_count ?? 0);
  const sowerCount = Number(r?.sower_count ?? 0);
  return {
    giftCount,
    giftRevenue: Number(r?.gift_revenue ?? 0),
    giftConversionRate: sends > 0 ? (giftCount / sends) * 100 : 0,
    avgTimeToGiftHours: r?.avg_time_to_gift_seconds ? Number(r.avg_time_to_gift_seconds) / 3600 : 0,
    sowerCount,
    sowerConversionRate: sends > 0 ? (sowerCount / sends) * 100 : 0,
  };
}

/**
 * Cached per-agent gift metrics (900s). The underlying $queryRaw aggregates over a
 * 30-day window of UserDecision; without caching it re-ran on every performance-page
 * and overview-card render. Tagged `agent-${agentId}` so agent-scoped revalidation
 * busts it.
 */
export async function agentGiftMetrics(agentId: string): Promise<AgentGiftMetrics> {
  return unstable_cache(
    () => queryAgentGiftMetrics(agentId),
    ["agent-gift-metrics", agentId],
    { tags: [`agent-${agentId}`], revalidate: 900 },
  )();
}
