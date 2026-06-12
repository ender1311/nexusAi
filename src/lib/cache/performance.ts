/**
 * Performance-page `unstable_cache` wrappers.
 * See ./index.ts for the tag taxonomy.
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { TTL } from "./ttl";

/** Per-agent send/conversion aggregates for the last 30 days. */
export const getCachedPerformanceMetrics = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // One $queryRaw replaces 4 parallel groupBy queries — single DB round-trip,
    // single index scan on @@index([sentAt]), same returned shape for consumers.
    const [agents, rows] = await Promise.all([
      prisma.agent.findMany({
        where: {},
        select: { id: true, name: true, status: true, targetSegmentName: true },
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
  { tags: ["performance"], revalidate: TTL.STANDARD }
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
  { tags: ["performance"], revalidate: TTL.STANDARD }
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
      prisma.messageVariant.findMany({ where: { status: "active" }, select: { id: true, name: true }, take: 200 }),
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
  { tags: ["performance"], revalidate: TTL.STANDARD }
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
  { tags: ["performance"], revalidate: TTL.STANDARD }
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
  { tags: ["performance"], revalidate: TTL.STANDARD }
);

/**
 * Lift counts for the performance page, keyed by liftSince date.
 *
 *  sendsCount / conversionsCount — scored sends (reward IS NOT NULL) and positive
 *    conversions (reward > 0), drive the Conversion Rate comparison.
 *  pushSendsCount / pushOpensCount — push channel sends and opens
 *    (channel='push' [AND pushOpenAt IS NOT NULL]), drive the Push Open Rate comparison.
 */
export function getCachedLiftCounts(liftSince: Date | null) {
  const liftSinceKey = liftSince instanceof Date ? liftSince.toISOString() : (liftSince ?? "all");
  return unstable_cache(
    async () => {
      const filter = liftSince ? { gte: liftSince } : undefined;
      const [sendsCount, conversionsCount, pushSendsCount, pushOpensCount] = await Promise.all([
        prisma.userDecision.count({ where: { sentAt: filter, reward: { not: null } } }),
        prisma.userDecision.count({ where: { sentAt: filter, reward: { gt: 0 } } }),
        prisma.userDecision.count({ where: { sentAt: filter, channel: "push" } }),
        prisma.userDecision.count({ where: { sentAt: filter, channel: "push", pushOpenAt: { not: null } } }),
      ]);
      return { sendsCount, conversionsCount, pushSendsCount, pushOpensCount };
    },
    ["lift-counts", String(liftSinceKey)],
    { tags: ["performance"], revalidate: TTL.STANDARD }
  )();
}

/**
 * Lift measurement configuration from AppSetting.
 * Cached for 24h — tag-invalidated by the settings API on save.
 *
 *  baselineOpenRate — non-Nexus push open rate %, defaults to 1.2 when unset.
 *  baselineConvRate — non-Nexus conversion rate %, defaults to 0 (unset) so the
 *    Conversion Rate comparison shows no baseline until the user enters a real number.
 *  liftSince — ISO start date for the lift window, or null for all-time.
 *
 * `liftSince` is an ISO string (not a Date): unstable_cache JSON-serializes its
 * payload, so a Date would arrive at the caller as a string anyway. Returning a
 * string keeps the type honest — callers parse with `new Date(liftSince)`.
 */
export const getCachedLiftSettings = unstable_cache(
  async (): Promise<{ baselineOpenRate: number; baselineConvRate: number; liftSince: string | null }> => {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ["baseline_push_open_rate", "baseline_conversion_rate", "lift_since_date"] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const baselineOpenRate = parseFloat(map["baseline_push_open_rate"] ?? "1.2");
    const baselineConvRate = parseFloat(map["baseline_conversion_rate"] ?? "0");
    const sinceDateStr = map["lift_since_date"] ?? "";
    const liftSince = (() => {
      if (!sinceDateStr) return null;
      const d = new Date(sinceDateStr);
      return isNaN(d.getTime()) ? null : d.toISOString();
    })();
    return {
      baselineOpenRate: isNaN(baselineOpenRate) ? 1.2 : baselineOpenRate,
      baselineConvRate: isNaN(baselineConvRate) ? 0 : baselineConvRate,
      liftSince,
    };
  },
  ["lift-settings"],
  { tags: ["lift-settings"], revalidate: TTL.DAY }
);
