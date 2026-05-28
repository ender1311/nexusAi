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
 *   "dashboard-stats" — new decisions recorded (busted hourly by cron)
 *   "user-count"      — total tracked-user count (long TTL; cron never busts it)
 *   "performance"     — new decisions recorded
 *   "segments"        — HT segment membership (busted by POST /api/ingest/segments)
 *   "braze-stats"     — Braze campaign analytics (busted by ingest-braze-analytics cron every 6h)
 */
import { cache } from "react";
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

// ── Slow-moving counts ───────────────────────────────────────────────────────

/**
 * Total TrackedUser row count. Tagged "user-count" (not "dashboard-stats") so
 * the hourly cron revalidateTag("dashboard-stats") does NOT bust this.
 * COUNT(*) on 19M+ rows is a full table scan — we only want it to run once/day.
 */
export const getCachedTrackedUserCount = cache(
  unstable_cache(
    () => prisma.trackedUser.count(),
    ["tracked-user-count"],
    { tags: ["user-count"], revalidate: 86400 }
  )
);

// ── Agent data ────────────────────────────────────────────────────────────────

/** Lightweight agent list for dashboard sidebar. Direct DB query avoids HTTP round-trip on cold start. */
export const getCachedAgentList = cache(
  unstable_cache(
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
  )
);

/** Agent list for control tower — includes funnelStage and description. */
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
export const getCachedPersonaDistribution = cache(
  unstable_cache(
    () =>
      prisma.persona.findMany({
        where: { isActive: true },
        select: { name: true, label: true, color: true, _count: { select: { trackedUsers: true } } },
        orderBy: { trackedUsers: { _count: "desc" } },
        take: 20,
      }),
    ["personas-distribution"],
    { tags: ["personas"], revalidate: 900 }
  )
);

// ── Dashboard counts ──────────────────────────────────────────────────────────

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
    { tags: ["dashboard-stats"], revalidate: 900 }
  )
);

// ── Dashboard time-series and recent-sends ────────────────────────────────────

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
  { tags: ["dashboard-stats"], revalidate: 900 }
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
    { tags: ["dashboard-stats"], revalidate: 900 }
  )
);

// ── Performance page data ─────────────────────────────────────────────────────

/** Per-agent send/conversion aggregates for the last 30 days. */
export const getCachedPerformanceMetrics = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // One $queryRaw replaces 4 parallel groupBy queries — single DB round-trip,
    // single index scan on @@index([sentAt]), same returned shape for consumers.
    const [agents, rows] = await Promise.all([
      prisma.agent.findMany({
        where: { name: { not: LIBRARY_AGENT_NAME } },
        select: { id: true, name: true, status: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.$queryRaw<Array<{
        agent_id: string;
        sends: bigint;
        conversions: bigint;
        push_sends: bigint;
        push_opens: bigint;
      }>>`
        SELECT
          "agentId"                                                                          AS agent_id,
          COUNT(*)::bigint                                                                   AS sends,
          COUNT("conversionAt")::bigint                                                     AS conversions,
          COUNT(*) FILTER (WHERE "channel" = 'push')::bigint                               AS push_sends,
          COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL)::bigint  AS push_opens
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
        GROUP BY "agentId"
      `,
    ]);
    // Reconstruct the same array shapes consumers expect
    const sendsByAgent        = rows.map((r) => ({ agentId: r.agent_id, _count: { id: Number(r.sends) } }));
    const conversionsByAgent  = rows.map((r) => ({ agentId: r.agent_id, _count: { id: Number(r.conversions) } }));
    const pushSendsByAgent    = rows.map((r) => ({ agentId: r.agent_id, _count: { id: Number(r.push_sends) } }));
    const pushOpensByAgent    = rows.map((r) => ({ agentId: r.agent_id, _count: { id: Number(r.push_opens) } }));
    return { agents, sendsByAgent, conversionsByAgent, pushSendsByAgent, pushOpensByAgent };
  },
  ["performance-metrics"],
  { tags: ["performance"], revalidate: 900 }
);

/** Per-variant send/conversion/reward aggregates for the last 30 days. */
export const getCachedVariantMetrics = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Single scan grouped by (variantId, channel) — conversions and rewards
    // are aggregated per channel row then reconstructed into the original shapes.
    const rows = await prisma.$queryRaw<Array<{
      variant_id: string;
      channel: string;
      sends: bigint;
      conversions: bigint;
      total_reward: number | null;
    }>>`
      SELECT
        "messageVariantId"              AS variant_id,
        "channel",
        COUNT(*)::bigint                AS sends,
        COUNT("conversionAt")::bigint   AS conversions,
        SUM(reward)::float              AS total_reward
      FROM "UserDecision"
      WHERE "sentAt" >= ${thirtyDaysAgo}
        AND "messageVariantId" IS NOT NULL
      GROUP BY "messageVariantId", "channel"
    `;
    // Reconstruct original shapes expected by consumers
    const variantSends = rows.map((r) => ({
      messageVariantId: r.variant_id,
      channel: r.channel,
      _count: { id: Number(r.sends) },
    }));
    // Aggregate conversions across channels per variant
    const convMap = new Map<string, number>();
    const rewardMap = new Map<string, number>();
    for (const r of rows) {
      convMap.set(r.variant_id, (convMap.get(r.variant_id) ?? 0) + Number(r.conversions));
      rewardMap.set(r.variant_id, (rewardMap.get(r.variant_id) ?? 0) + (r.total_reward ?? 0));
    }
    const variantConversions = [...convMap.entries()].map(([id, count]) => ({
      messageVariantId: id,
      _count: { id: count },
    }));
    const variantRewards = [...rewardMap.entries()].map(([id, sum]) => ({
      messageVariantId: id,
      _sum: { reward: sum },
    }));
    return { variantSends, variantConversions, variantRewards };
  },
  ["performance-variants"],
  { tags: ["performance"], revalidate: 900 }
);

/**
 * Persona × variant win-rate matrix from PersonaArmStats.
 * Returns top-10 personas × top-10 variants by total tries.
 * Each cell: { tries, alpha } where convRate ≈ (alpha-1)/tries.
 */
export const getCachedPersonaVariantMatrix = unstable_cache(
  async () => {
    const [rows, personas, variants] = await Promise.all([
      prisma.personaArmStats.groupBy({
        by: ["personaId", "variantId"],
        _sum: { tries: true, alpha: true },
      }),
      prisma.persona.findMany({ select: { id: true, label: true, name: true }, where: { isActive: true } }),
      prisma.messageVariant.findMany({ select: { id: true, name: true } }),
    ]);

    // Build lookup maps
    const personaLabel = new Map(personas.map((p) => [p.id, p.label ?? p.name]));
    const variantName = new Map(variants.map((v) => [v.id, v.name]));

    // Aggregate tries per persona and variant for top-N selection
    const triesByPersona = new Map<string, number>();
    const triesByVariant = new Map<string, number>();
    for (const r of rows) {
      const t = r._sum.tries ?? 0;
      triesByPersona.set(r.personaId, (triesByPersona.get(r.personaId) ?? 0) + t);
      triesByVariant.set(r.variantId, (triesByVariant.get(r.variantId) ?? 0) + t);
    }

    const topPersonaIds = [...triesByPersona.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
    const topVariantIds = [...triesByVariant.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    const topPersonaSet = new Set(topPersonaIds);
    const topVariantSet = new Set(topVariantIds);

    // Build cell map: "personaId:variantId" → { tries, alpha }
    const cells = new Map<string, { tries: number; alpha: number }>();
    for (const r of rows) {
      if (!topPersonaSet.has(r.personaId) || !topVariantSet.has(r.variantId)) continue;
      const key = `${r.personaId}:${r.variantId}`;
      cells.set(key, { tries: r._sum.tries ?? 0, alpha: r._sum.alpha ?? 1 });
    }

    return {
      personaIds: topPersonaIds,
      variantIds: topVariantIds,
      personaLabels: topPersonaIds.map((id) => personaLabel.get(id) ?? id),
      variantNames: topVariantIds.map((id) => variantName.get(id) ?? id),
      cells: [...cells.entries()].map(([key, v]) => {
        const [pId, vId] = key.split(":");
        return { personaId: pId, variantId: vId, tries: v.tries, alpha: v.alpha };
      }),
    };
  },
  ["persona-variant-matrix"],
  { tags: ["performance"], revalidate: 900 }
);

/**
 * Per-agent convergence state derived from PersonaArmStats.
 * Groups arm stats by (agentId, variantId), computes topShare to classify state.
 */
export const getCachedAgentConvergenceStates = unstable_cache(
  async () => {
    const stats = await prisma.personaArmStats.groupBy({
      by: ["agentId", "variantId"],
      _sum: { tries: true },
    });
    const byAgent = new Map<string, number[]>();
    for (const row of stats) {
      const tries = row._sum.tries ?? 0;
      const arr = byAgent.get(row.agentId) ?? [];
      arr.push(tries);
      byAgent.set(row.agentId, arr);
    }
    const result: Record<string, "exploring" | "learning" | "converging" | "confident"> = {};
    for (const [agentId, triesList] of byAgent) {
      const total = triesList.reduce((s, t) => s + t, 0);
      const topShare = total > 0 ? Math.max(...triesList) / total : 0;
      if (total < 20 || topShare < 0.35) result[agentId] = "exploring";
      else if (topShare < 0.5) result[agentId] = "learning";
      else if (topShare < 0.7) result[agentId] = "converging";
      else result[agentId] = "confident";
    }
    return result;
  },
  ["agent-convergence-states"],
  { tags: ["performance"], revalidate: 900 }
);

/** All variant id+name pairs for display in performance tables. */
export const getCachedAllVariantNames = cache(
  unstable_cache(
    () => prisma.messageVariant.findMany({ select: { id: true, name: true } }),
    ["all-variant-names"],
    { tags: ["agents"], revalidate: 900 }
  )
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
    const [byDateRows, heatmapRows, hourlyRows, rewardRows] = await Promise.all([
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
      // Use scheduledFor when available — for in_local_time sends it stores the local delivery hour
      // (e.g. 08:00Z meaning "8am in user's timezone"). Fall back to sentAt for immediate sends.
      prisma.$queryRaw<Array<{ hour: bigint; dow: bigint; count: bigint }>>`
        SELECT EXTRACT(HOUR FROM COALESCE("scheduledFor", "sentAt"))::bigint AS hour,
               EXTRACT(DOW  FROM COALESCE("scheduledFor", "sentAt"))::bigint AS dow,
               COUNT(*)::bigint                                               AS count
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
        GROUP BY 1, 2
      `,
      // Per-hour sends + conversions for send-time intelligence chart
      prisma.$queryRaw<Array<{ hour: bigint; sends: bigint; conversions: bigint }>>`
        SELECT EXTRACT(HOUR FROM COALESCE("scheduledFor", "sentAt"))::bigint AS hour,
               COUNT(*)::bigint                                               AS sends,
               COUNT("conversionAt")::bigint                                  AS conversions
        FROM "UserDecision"
        WHERE "sentAt" >= ${thirtyDaysAgo}
        GROUP BY 1
        ORDER BY 1 ASC
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
      hourly: hourlyRows.map((r) => ({
        hour: Number(r.hour),
        sends: Number(r.sends),
        conversions: Number(r.conversions),
        convRate: Number(r.sends) > 0 ? (Number(r.conversions) / Number(r.sends)) * 100 : 0,
      })),
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
export const getCachedBrazeStats = cache(unstable_cache(
  async () => {
    const campaignId = process.env.BRAZE_NEXUS_CAMPAIGN_ID;
    if (!campaignId) return null;
    const brazeClient = createBrazeClient();
    if (!brazeClient) return null;
    try {
      const daysSince = 60;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let res: Response;
      try {
        res = await brazeClient.get(
          "/campaigns/data_series",
          { campaign_id: campaignId, length: Math.max(daysSince, 3) },
          controller.signal,
        );
      } finally {
        clearTimeout(timeoutId);
      }
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
  { tags: ["braze-stats"], revalidate: 14400 }
));

// ── Control Tower stats ───────────────────────────────────────────────────────

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
    { tags: ["funnel-breakdown"], revalidate: 14400 }
  )
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

// ── Segment data ──────────────────────────────────────────────────────────────

export type SegmentInfo = { name: string; userCount: number; assignedTo: string | null };

/** Distinct HT segments with member count and assigned agent. Busted by POST /api/ingest/segments. */
export const getCachedSegments = unstable_cache(
  async (): Promise<SegmentInfo[]> => {
    const [rows, agents] = await Promise.all([
      prisma.userSegment.groupBy({ by: ["segmentName"], _count: { _all: true }, orderBy: { segmentName: "asc" } }),
      prisma.agent.findMany({ where: { targetSegmentName: { not: null } }, select: { targetSegmentName: true, name: true } }),
    ]);
    const assignedTo = new Map(agents.map((a) => [a.targetSegmentName!, a.name]));
    return rows.map((r) => ({
      name: r.segmentName,
      userCount: r._count._all,
      assignedTo: assignedTo.get(r.segmentName) ?? null,
    }));
  },
  ["segments"],
  { tags: ["segments"], revalidate: 900 }
);
