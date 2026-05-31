/**
 * Dashboard + control-tower `unstable_cache` wrappers.
 * See ./index.ts for the tag taxonomy.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { TTL } from "./ttl";

/**
 * Total TrackedUser row count. Tagged "user-count" (not "dashboard-stats") so
 * the hourly cron revalidateTag("dashboard-stats") does NOT bust this.
 * COUNT(*) on 19M+ rows is a full table scan — we only want it to run once/day.
 */
export const getCachedTrackedUserCount = cache(
  unstable_cache(
    () => prisma.trackedUser.count(),
    ["tracked-user-count"],
    { tags: ["user-count"], revalidate: TTL.DAY }
  )
);

/** Aggregate counts shown in dashboard metric cards. Scoped to last 30 days to use the sentAt index. */
export const getCachedDashboardCounts = cache(
  unstable_cache(
    async () => {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // Single aggregated pass with a WHERE on sentAt so Postgres uses @@index([sentAt])
      // instead of a full table scan. "total_decisions" etc. are now 30-day figures.
      // trackedUser.count() is intentionally excluded — it's a full-table scan on 19M+ rows.
      // Use getCachedTrackedUserCount() separately (24h TTL, not busted by hourly cron).
      const rows = await prisma.$queryRaw<[{
        sent_last24h: bigint;
        total_decisions: bigint;
        total_conversions: bigint;
        total_push_sends: bigint;
        total_push_opens: bigint;
      }]>`
        SELECT
          COUNT(*) FILTER (WHERE "sentAt" >= ${twentyFourHoursAgo})                          AS sent_last24h,
          COUNT(*)                                                                             AS total_decisions,
          COUNT(*) FILTER (WHERE "conversionAt" IS NOT NULL)                                  AS total_conversions,
          COUNT(*) FILTER (WHERE "channel" = 'push')                                          AS total_push_sends,
          COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL)             AS total_push_opens
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
      `;
      const r = rows[0];
      return {
        sentLast24h:      Number(r.sent_last24h),
        totalDecisions:   Number(r.total_decisions),
        totalConversions: Number(r.total_conversions),
        totalPushSends:   Number(r.total_push_sends),
        totalPushOpens:   Number(r.total_push_opens),
      };
    },
    ["dashboard-counts"],
    { tags: ["dashboard-stats"], revalidate: TTL.STANDARD }
  )
);

/**
 * 7-day pre-aggregated send/conversion counts for the dashboard chart.
 * DB-side GROUP BY replaces a 50k-row JS scan — counts are always exact.
 */
export const getCachedDashboardTimeSeries = cache(unstable_cache(
  async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await prisma.$queryRaw<Array<{ date: string; sends: bigint; conversions: bigint }>>`
      SELECT TO_CHAR("sentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
             COUNT(*)::bigint                                     AS sends,
             COUNT("conversionAt")::bigint                       AS conversions
      FROM "UserDecision"
      WHERE "sentAt" >= ${sevenDaysAgo}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      date: r.date,
      sends: Number(r.sends),
      conversions: Number(r.conversions),
    }));
  },
  ["dashboard-timeseries"],
  { tags: ["dashboard-stats"], revalidate: TTL.STANDARD }
));

/** Last 10 decisions for the dashboard recent-sends feed. */
export const getCachedRecentDecisions = cache(
  unstable_cache(
    async () => {
      const rows = await prisma.userDecision.findMany({
        select: {
          id: true,
          userId: true,
          channel: true,
          sentAt: true,
          conversionAt: true,
          reward: true,
          agentId: true,
          messageVariantId: true,
        },
        orderBy: { sentAt: "desc" },
        take: 10,
      });
      return rows.map((r) => ({
        ...r,
        sentAt: r.sentAt.toISOString(),
        conversionAt: r.conversionAt?.toISOString() ?? null,
      }));
    },
    ["dashboard-recent-decisions"],
    { tags: ["dashboard-stats"], revalidate: TTL.STANDARD }
  )
);

/**
 * Funnel stage breakdown for dashboard + control tower.
 * Tagged "funnel-breakdown" (NOT "dashboard-stats") so the hourly cron
 * revalidateTag("dashboard-stats") does not bust this GROUP BY query on 19M+ rows.
 * 4-hour TTL — funnel distribution changes slowly.
 */
export const getCachedFunnelStageBreakdown = cache(
  unstable_cache(
    async () => {
      const rows = await prisma.trackedUser.groupBy({
        by: ["funnelStage"],
        _count: { _all: true },
        orderBy: { _count: { funnelStage: "desc" } },
      });
      return rows.map((r) => ({ stage: r.funnelStage ?? "unknown", count: r._count._all }));
    },
    ["funnel-stage-breakdown"],
    { tags: ["funnel-breakdown"], revalidate: TTL.LONG }
  )
);

export const getCachedControlTowerStats = unstable_cache(
  async () => {
    const [trackedUsers, personas, agents, decisionRows] = await Promise.all([
      prisma.trackedUser.count(),
      prisma.persona.count({ where: { isActive: true } }),
      prisma.agent.count({ where: { status: "active" } }),
      // Single scan for both total and conversion counts (avoids two separate table scans)
      prisma.$queryRaw<[{ total: bigint; conversions: bigint }]>`
        SELECT COUNT(*)::bigint AS total, COUNT("conversionAt")::bigint AS conversions
        FROM "UserDecision"
      `,
    ]);
    const d = decisionRows[0] ?? { total: 0 as unknown as bigint, conversions: 0 as unknown as bigint };
    return {
      trackedUsers,
      personas,
      agents,
      totalDecisions: Number(d.total),
      totalConversions: Number(d.conversions),
    };
  },
  ["control-tower-stats"],
  { tags: ["dashboard-stats", "agents", "personas"], revalidate: TTL.STANDARD }
);
