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
 * Preferred-channel visibility (synced from Hightouch into TrackedUser.attributes).
 *  - external_90: push-vs-email preference over the last 90 days — the actionable
 *    signal for an outbound push agent. Surfaced in the agent-creation wizard.
 *  - overall_90: preference across all four channels — the dashboard portfolio view.
 * Single full-table scan via FILTER aggregates. Tagged "user-count" (NOT
 * "dashboard-stats") and DAY TTL so the hourly cron does not bust this 33M-row scan.
 */
export type PreferredChannelStats = {
  total: number;
  external: { push_notification: number; email: number };
  overall: { push_notification: number; email: number; in_app_message: number; content_card: number };
};

export const getCachedPreferredChannelStats = cache(
  unstable_cache(
    async (): Promise<PreferredChannelStats> => {
      const rows = await prisma.$queryRaw<[{
        total: bigint;
        ext_push: bigint;
        ext_email: bigint;
        ov_push: bigint;
        ov_email: bigint;
        ov_inapp: bigint;
        ov_cc: bigint;
      }]>`
        SELECT
          COUNT(*)::bigint                                                                                       AS total,
          COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_external_90_days' = 'push_notification')::bigint AS ext_push,
          COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_external_90_days' = 'email')::bigint             AS ext_email,
          COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'push_notification')::bigint  AS ov_push,
          COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'email')::bigint              AS ov_email,
          COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'in_app_message')::bigint     AS ov_inapp,
          COUNT(*) FILTER (WHERE "attributes"->>'preferred_channel_overall_90_days' = 'content_card')::bigint       AS ov_cc
        FROM "User"
      `;
      const r = rows[0];
      return {
        total: Number(r.total),
        external: {
          push_notification: Number(r.ext_push),
          email: Number(r.ext_email),
        },
        overall: {
          push_notification: Number(r.ov_push),
          email: Number(r.ov_email),
          in_app_message: Number(r.ov_inapp),
          content_card: Number(r.ov_cc),
        },
      };
    },
    ["preferred-channel-stats"],
    { tags: ["user-count"], revalidate: TTL.DAY }
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

/**
 * Fleet re-engagement KPIs (spec C2). Recoveries = all FunnelTransition rows in the
 * window; attributed = those credited to an agent; rate = attributed ÷ users owned in
 * the window. Tagged "funnel-breakdown" (slow-moving; not busted by the hourly cron).
 */
export const getCachedFleetRecoveryStats = cache(
  unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [recoveries30d, attributedRecoveries30d, ownedInWindow] = await Promise.all([
        prisma.funnelTransition.count({ where: { detectedAt: { gte: thirtyDaysAgo } } }),
        prisma.funnelTransition.count({ where: { detectedAt: { gte: thirtyDaysAgo }, attributedAgentId: { not: null } } }),
        prisma.userAgentAssignment.count({ where: { startedAt: { gte: thirtyDaysAgo } } }),
      ]);
      return {
        recoveries30d,
        attributedRecoveries30d,
        fleetRecoveryRate: ownedInWindow > 0 ? (attributedRecoveries30d / ownedInWindow) * 100 : 0,
      };
    },
    ["fleet-recovery-stats"],
    { tags: ["funnel-breakdown"], revalidate: TTL.LONG }
  )
);

/** Per-agent recovery leaderboard (spec C2). One groupBy + a name lookup. */
export const getCachedRecoveryLeaderboard = cache(
  unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const grouped = await prisma.funnelTransition.groupBy({
        by: ["attributedAgentId"],
        where: { detectedAt: { gte: thirtyDaysAgo }, attributedAgentId: { not: null } },
        _count: { _all: true },
      });
      const agentIds = grouped.map((g) => g.attributedAgentId!).filter(Boolean);
      const [agents, rewardRows] = await Promise.all([
        prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, color: true } }),
        prisma.userDecision.groupBy({
          by: ["agentId"],
          where: { agentId: { in: agentIds }, conversionEvent: "funnel_recovery", conversionAt: { gte: thirtyDaysAgo } },
          _sum: { reward: true },
        }),
      ]);
      const nameById = new Map(agents.map((a) => [a.id, a]));
      const rewardById = new Map(rewardRows.map((r) => [r.agentId, r._sum.reward ?? 0]));
      return grouped
        .map((g) => ({
          agentId: g.attributedAgentId!,
          name: nameById.get(g.attributedAgentId!)?.name ?? g.attributedAgentId!,
          color: nameById.get(g.attributedAgentId!)?.color ?? "#888888",
          recoveries: g._count._all,
          reward: rewardById.get(g.attributedAgentId!) ?? 0,
        }))
        .sort((a, b) => b.recoveries - a.recoveries);
    },
    ["recovery-leaderboard"],
    { tags: ["funnel-breakdown", "agents"], revalidate: TTL.LONG }
  )
);

/** Fleet from→to recovery breakdown (spec C2). */
export const getCachedFleetTransitionBreakdown = cache(
  unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await prisma.funnelTransition.groupBy({
        by: ["fromStage", "toStage"],
        where: { detectedAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      });
      return rows
        .map((r) => ({ label: `${r.fromStage}→${r.toStage}`, count: r._count._all }))
        .sort((a, b) => b.count - a.count);
    },
    ["fleet-transition-breakdown"],
    { tags: ["funnel-breakdown"], revalidate: TTL.LONG }
  )
);

/** Fleet recovery trend, recoveries/day for 7 days (spec C2). DB-side GROUP BY. */
export const getCachedFleetRecoveryTrend = cache(
  unstable_cache(
    async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await prisma.$queryRaw<Array<{ date: string; recoveries: bigint }>>`
        SELECT TO_CHAR("detectedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint                                        AS recoveries
        FROM "FunnelTransition"
        WHERE "detectedAt" >= ${sevenDaysAgo}
        GROUP BY 1
        ORDER BY 1 ASC
      `;
      return rows.map((r) => ({ date: r.date, recoveries: Number(r.recoveries) }));
    },
    ["fleet-recovery-trend"],
    { tags: ["funnel-breakdown"], revalidate: TTL.LONG }
  )
);

/**
 * Stats-bar figures for the control tower: total users tracked, active personas,
 * and all-time decisions/conversions. All four are slow-moving cumulative totals,
 * so this is cached for a DAY under "user-count"/"personas" (NOT "dashboard-stats")
 * — the hourly cron must not bust it and re-trigger two full-table scans on the
 * ~19M-row TrackedUser and UserDecision tables. The user count is delegated to
 * getCachedTrackedUserCount so the 19M-row TrackedUser scan is shared with the
 * dashboard and runs at most once/day.
 */
export const getCachedControlTowerStats = cache(unstable_cache(
  async () => {
    const [trackedUsers, personas, decisionRows] = await Promise.all([
      getCachedTrackedUserCount(),
      prisma.persona.count({ where: { isActive: true } }),
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
      totalDecisions: Number(d.total),
      totalConversions: Number(d.conversions),
    };
  },
  ["control-tower-stats"],
  { tags: ["user-count", "personas"], revalidate: TTL.DAY }
));

/**
 * Fleet gift insight: attributed gift count + USD revenue (SUM of conversionValue)
 * for gift_given decisions in the 30-day window, plus an agent revenue leaderboard.
 * Tagged "dashboard-stats" so the hourly cron refreshes it.
 */
export const getCachedFleetGiftStats = cache(
  unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [totals, leaderboardRows] = await Promise.all([
        prisma.$queryRaw<[{ gift_count: bigint; gift_revenue: number | null }]>`
          SELECT COUNT(*)::bigint                         AS gift_count,
                 COALESCE(SUM("conversionValue"), 0)::float AS gift_revenue
          FROM "UserDecision"
          WHERE "conversionEvent" = 'gift_given'
            AND "conversionAt" >= ${thirtyDaysAgo}
        `,
        prisma.$queryRaw<Array<{ agent_id: string; revenue: number | null; gifts: bigint }>>`
          SELECT "agentId"                                  AS agent_id,
                 COALESCE(SUM("conversionValue"), 0)::float AS revenue,
                 COUNT(*)::bigint                           AS gifts
          FROM "UserDecision"
          WHERE "conversionEvent" = 'gift_given'
            AND "conversionAt" >= ${thirtyDaysAgo}
          GROUP BY "agentId"
          ORDER BY revenue DESC
          LIMIT 5
        `,
      ]);
      const agentIds = leaderboardRows.map((r) => r.agent_id);
      const agents = agentIds.length > 0
        ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, color: true } })
        : [];
      const byId = new Map(agents.map((a) => [a.id, a]));
      return {
        giftCount: Number(totals[0]?.gift_count ?? 0),
        giftRevenue: Number(totals[0]?.gift_revenue ?? 0),
        leaderboard: leaderboardRows.map((r) => ({
          agentId: r.agent_id,
          name: byId.get(r.agent_id)?.name ?? r.agent_id,
          color: byId.get(r.agent_id)?.color ?? "#888888",
          revenue: Number(r.revenue ?? 0),
          gifts: Number(r.gifts),
        })),
      };
    },
    ["fleet-gift-stats"],
    { tags: ["dashboard-stats", "agents"], revalidate: TTL.STANDARD }
  )
);
