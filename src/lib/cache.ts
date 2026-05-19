/**
 * Shared `unstable_cache` wrappers for expensive DB queries.
 *
 * Two-layer caching:
 *   ISR (`revalidate = 900` on pages) → CDN-cached HTML, <100ms on hit
 *   unstable_cache here → server-side data cache; when ISR misses, re-render
 *   reads from here instead of hitting the DB (~50ms vs ~1.5s).
 *
 * Tag taxonomy:
 *   "agents"          — any agent mutation (create/update/delete)
 *   "agent-${id}"     — specific agent mutation
 *   "personas"        — persona changes
 *   "dashboard-stats" — new decisions recorded
 *   "performance"     — new decisions recorded
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";

// ── Agent data ───────────────────────────────────────────────────────────────

/** Full agent detail with all relations. Tagged for targeted invalidation. */
export function getCachedAgent(id: string) {
  return unstable_cache(
    () =>
      prisma.agent.findUnique({
        where: { id },
        include: {
          goals: true,
          messages: { include: { variants: true } },
          schedulingRule: true,
          personaTargets: { include: { persona: true } },
          _count: { select: { decisions: true } },
        },
      }),
    ["agent", id],
    { tags: [`agent-${id}`, "agents"], revalidate: 900 }
  )();
}

/** User count by persona + preview users for an agent's audience tab. */
export function getCachedAgentAudienceData(agentId: string, personaIds: string[]) {
  const key = personaIds.slice().sort().join(",");
  return unstable_cache(
    async () => {
      if (personaIds.length === 0) return { userCountRows: [], previewUsers: [] };
      const [userCountRows, previewUsers] = await Promise.all([
        prisma.trackedUser.groupBy({
          by: ["personaId"],
          where: { personaId: { in: personaIds } },
          _count: { personaId: true },
        }),
        prisma.trackedUser.findMany({
          where: { personaId: { in: personaIds } },
          select: { externalId: true, personaId: true, attributes: true },
          take: 20,
        }),
      ]);
      return { userCountRows, previewUsers };
    },
    ["agent-audience", agentId, key],
    { tags: [`agent-${agentId}`, "agents"], revalidate: 900 }
  )();
}

/** Lightweight agent list for dashboard sidebar. Direct DB query avoids HTTP round-trip on cold start. */
export const getCachedAgentList = unstable_cache(
  () =>
    prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ["agent-list"],
  { tags: ["agents"], revalidate: 900 }
);

/** Agent list for control tower — includes funnelStage and description (60s TTL). */
export const getCachedControlTowerAgents = unstable_cache(
  () =>
    prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      select: { id: true, name: true, description: true, status: true, funnelStage: true, color: true },
      orderBy: { updatedAt: "desc" },
    }),
  ["control-tower-agents"],
  { tags: ["agents"], revalidate: 900 }
);

// ── Persona data ─────────────────────────────────────────────────────────────

/** Active personas with minimal fields — used in dropdowns/selectors. */
export const getCachedActivePersonas = unstable_cache(
  () =>
    prisma.persona.findMany({
      where: { isActive: true },
      select: { id: true, name: true, label: true, icon: true, color: true },
      orderBy: { name: "asc" },
    }),
  ["personas-active"],
  { tags: ["personas"], revalidate: 900 }
);

/** Persona distribution with user counts for the dashboard chart. */
export const getCachedPersonaDistribution = unstable_cache(
  () =>
    prisma.persona.findMany({
      where: { isActive: true },
      select: { name: true, label: true, color: true, _count: { select: { trackedUsers: true } } },
      orderBy: { name: "asc" },
    }),
  ["personas-distribution"],
  { tags: ["personas"], revalidate: 900 }
);

// ── Dashboard counts ──────────────────────────────────────────────────────────

/** Aggregate counts shown in dashboard metric cards. */
export const getCachedDashboardCounts = unstable_cache(
  async () => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [sentLast24h, totalDecisions, totalConversions, trackedUsers, totalPushSends, totalPushOpens] = await Promise.all([
      prisma.userDecision.count({ where: { sentAt: { gte: twentyFourHoursAgo } } }),
      prisma.userDecision.count(),
      prisma.userDecision.count({ where: { conversionAt: { not: null } } }),
      prisma.trackedUser.count(),
      prisma.userDecision.count({ where: { channel: "push" } }),
      prisma.userDecision.count({ where: { channel: "push", pushOpenAt: { not: null } } }),
    ]);
    return { sentLast24h, totalDecisions, totalConversions, trackedUsers, totalPushSends, totalPushOpens };
  },
  ["dashboard-counts"],
  { tags: ["dashboard-stats"], revalidate: 900 }
);

// ── Dashboard time-series and recent-sends ────────────────────────────────────

/**
 * 7-day pre-aggregated send/conversion counts for the dashboard chart.
 * DB-side GROUP BY replaces a 50k-row JS scan — counts are always exact.
 */
export const getCachedDashboardTimeSeries = unstable_cache(
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
  { tags: ["dashboard-stats"], revalidate: 900 }
);

/** Last 10 decisions for the dashboard recent-sends feed. */
export const getCachedRecentDecisions = unstable_cache(
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
        variant: { select: { name: true } },
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
  { tags: ["dashboard-stats"], revalidate: 900 }
);

// ── Performance page data ─────────────────────────────────────────────────────

/** Per-agent send/conversion aggregates for the last 30 days. */
export const getCachedPerformanceMetrics = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [agents, sendsByAgent, conversionsByAgent, pushSendsByAgent, pushOpensByAgent] = await Promise.all([
      prisma.agent.findMany({
        where: { name: { not: LIBRARY_AGENT_NAME } },
        select: { id: true, name: true, status: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { sentAt: { gte: thirtyDaysAgo } },
        _count: { id: true },
      }),
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { sentAt: { gte: thirtyDaysAgo }, conversionAt: { not: null } },
        _count: { id: true },
      }),
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { sentAt: { gte: thirtyDaysAgo }, channel: "push" },
        _count: { id: true },
      }),
      prisma.userDecision.groupBy({
        by: ["agentId"],
        where: { sentAt: { gte: thirtyDaysAgo }, channel: "push", pushOpenAt: { not: null } },
        _count: { id: true },
      }),
    ]);
    return { agents, sendsByAgent, conversionsByAgent, pushSendsByAgent, pushOpensByAgent };
  },
  ["performance-metrics"],
  { tags: ["performance"], revalidate: 900 }
);

/** Per-variant send/conversion/reward aggregates for the last 30 days. */
export const getCachedVariantMetrics = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [variantSends, variantConversions, variantRewards] = await Promise.all([
      prisma.userDecision.groupBy({
        by: ["messageVariantId", "channel"],
        where: { sentAt: { gte: thirtyDaysAgo }, messageVariantId: { not: null } },
        _count: { id: true },
      }),
      prisma.userDecision.groupBy({
        by: ["messageVariantId"],
        where: { sentAt: { gte: thirtyDaysAgo }, messageVariantId: { not: null }, conversionAt: { not: null } },
        _count: { id: true },
      }),
      prisma.userDecision.groupBy({
        by: ["messageVariantId"],
        where: { sentAt: { gte: thirtyDaysAgo }, messageVariantId: { not: null } },
        _sum: { reward: true },
      }),
    ]);
    return { variantSends, variantConversions, variantRewards };
  },
  ["performance-variants"],
  { tags: ["performance"], revalidate: 900 }
);

/** All variant id+name pairs for display in performance tables. */
export const getCachedAllVariantNames = unstable_cache(
  () => prisma.messageVariant.findMany({ select: { id: true, name: true } }),
  ["all-variant-names"],
  { tags: ["agents"], revalidate: 900 }
);

/**
 * Pre-aggregated 30-day decision data for timeseries/heatmap charts.
 * Three parallel DB aggregations replace a 50k-row JS scan — no row cap
 * means counts are always exact regardless of send volume.
 *
 *  byDate      — per-day send/conversion counts (time series)
 *  heatmap     — per-hour/day-of-week counts (timing heatmap)
 *  rewardByDate — per-day scored/positive counts (lift panel sparkline)
 */
export const getCachedChartDecisions = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [byDateRows, heatmapRows, rewardRows] = await Promise.all([
      // Per-day send/conversion counts (for time series)
      prisma.$queryRaw<Array<{ date: string; sends: bigint; conversions: bigint }>>`
        SELECT TO_CHAR("sentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint                                     AS sends,
               COUNT("conversionAt")::bigint                       AS conversions
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      // Per-hour/day-of-week counts (for timing heatmap)
      prisma.$queryRaw<Array<{ hour: bigint; dow: bigint; count: bigint }>>`
        SELECT EXTRACT(HOUR FROM "sentAt")::bigint     AS hour,
               EXTRACT(DOW  FROM "sentAt")::bigint     AS dow,
               COUNT(*)::bigint                        AS count
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
        GROUP BY 1, 2
      `,
      // Per-day scored/positive counts (for lift panel sparkline)
      prisma.$queryRaw<Array<{ date: string; scored: bigint; positive: bigint }>>`
        SELECT TO_CHAR("sentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint                                     AS scored,
               SUM(CASE WHEN reward > 0 THEN 1 ELSE 0 END)::bigint AS positive
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
          AND reward IS NOT NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);
    return {
      byDate: byDateRows.map((r) => ({ date: r.date, sends: Number(r.sends), conversions: Number(r.conversions) })),
      heatmap: heatmapRows.map((r) => ({ hour: Number(r.hour), dow: Number(r.dow), count: Number(r.count) })),
      rewardByDate: rewardRows.map((r) => ({ date: r.date, scored: Number(r.scored), positive: Number(r.positive) })),
    };
  },
  ["chart-decisions"],
  { tags: ["performance"], revalidate: 900 }
);

/** Lift send/conversion counts for the performance page, keyed by liftSince date. */
export function getCachedLiftCounts(liftSince: Date | null) {
  const liftSinceKey = liftSince instanceof Date ? liftSince.toISOString() : (liftSince ?? "all");
  return unstable_cache(
    async () => {
      const filter = liftSince ? { gte: liftSince } : undefined;
      const [sendsCount, conversionsCount] = await Promise.all([
        prisma.userDecision.count({ where: { sentAt: filter, reward: { not: null } } }),
        prisma.userDecision.count({ where: { sentAt: filter, reward: { gt: 0 } } }),
      ]);
      return { sendsCount, conversionsCount };
    },
    ["lift-counts", String(liftSinceKey)],
    { tags: ["performance"], revalidate: 900 }
  )();
}

/**
 * Lift measurement configuration from AppSetting.
 * Cached for 24h — tag-invalidated by the settings API on save.
 * Returns defaults (1.2% baseline, null since date) when keys are absent.
 */
export const getCachedLiftSettings = unstable_cache(
  async () => {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ["baseline_push_open_rate", "lift_since_date"] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const baselineRate = parseFloat(map["baseline_push_open_rate"] ?? "1.2");
    const sinceDateStr = map["lift_since_date"] ?? "";
    const liftSince = (() => {
      if (!sinceDateStr) return null;
      const d = new Date(sinceDateStr);
      return isNaN(d.getTime()) ? null : d;
    })();
    return {
      baselineRate: isNaN(baselineRate) ? 1.2 : baselineRate,
      liftSince,
    };
  },
  ["lift-settings"],
  { tags: ["lift-settings"], revalidate: 86400 }
);

// ── Braze campaign stats ──────────────────────────────────────────────────────

/** Braze campaign direct/total open rates, cached 15 min. Returns null when Braze is unconfigured. */
export const getCachedBrazeStats = unstable_cache(
  async () => {
    const campaignId = process.env.BRAZE_NEXUS_CAMPAIGN_ID;
    if (!campaignId) return null;
    const brazeClient = createBrazeClient();
    if (!brazeClient) return null;
    try {
      const daysSince = Math.ceil((Date.now() - new Date("2026-05-16").getTime()) / (86400 * 1000)) + 2;
      const res = await brazeClient.get("/campaigns/data_series", {
        campaign_id: campaignId,
        length: Math.max(daysSince, 3),
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Array<{ messages?: Record<string, unknown[]> }> };
      let sends = 0, directOpens = 0, totalOpens = 0;
      for (const point of (data.data ?? [])) {
        if (!point.messages) continue;
        for (const variations of Object.values(point.messages)) {
          if (!Array.isArray(variations)) continue;
          for (const v of variations) {
            const s = v as Record<string, unknown>;
            if (typeof s.sent === "number") sends += s.sent;
            else if (typeof s.sends === "number") sends += s.sends;
            if (typeof s.direct_opens === "number") directOpens += s.direct_opens;
            if (typeof s.total_opens === "number") totalOpens += s.total_opens;
          }
        }
      }
      if (sends === 0) return null;
      return {
        sends,
        directOpens,
        totalOpens,
        directOpenRate: parseFloat(((directOpens / sends) * 100).toFixed(2)),
        totalOpenRate: parseFloat(((totalOpens / sends) * 100).toFixed(2)),
      };
    } catch {
      return null;
    }
  },
  ["braze-campaign-stats"],
  { tags: ["braze-stats"], revalidate: 900 }
);

// ── Control Tower stats ───────────────────────────────────────────────────────

/** Aggregate counts for the control tower page (60s TTL). */
export const getCachedFunnelStageBreakdown = unstable_cache(
  async () => {
    const rows = await prisma.trackedUser.groupBy({
      by: ["funnelStage"],
      _count: { _all: true },
      orderBy: { _count: { funnelStage: "desc" } },
    });
    return rows.map((r) => ({ stage: r.funnelStage ?? "unknown", count: r._count._all }));
  },
  ["funnel-stage-breakdown"],
  { tags: ["dashboard-stats"], revalidate: 900 }
);

export const getCachedControlTowerStats = unstable_cache(
  async () => {
    const [trackedUsers, personas, agents, decisions, totalConversions] = await Promise.all([
      prisma.trackedUser.count(),
      prisma.persona.count({ where: { isActive: true } }),
      prisma.agent.count({ where: { status: "active" } }),
      prisma.userDecision.aggregate({ _count: { id: true }, _sum: { reward: true } }),
      prisma.userDecision.count({ where: { conversionAt: { not: null } } }),
    ]);
    return {
      trackedUsers,
      personas,
      agents,
      totalDecisions: decisions._count.id,
      totalConversions,
    };
  },
  ["control-tower-stats"],
  { tags: ["dashboard-stats", "agents", "personas"], revalidate: 900 }
);
