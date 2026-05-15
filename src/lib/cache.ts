/**
 * Shared `unstable_cache` wrappers for expensive DB queries.
 *
 * Two-layer caching:
 *   ISR (`revalidate = 30` on pages) → CDN-cached HTML, <100ms on hit
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
    { tags: [`agent-${id}`, "agents"], revalidate: 30 }
  )();
}

/** Lightweight agent list for dashboard sidebar. */
export const getCachedAgentList = unstable_cache(
  () =>
    prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ["agent-list"],
  { tags: ["agents"], revalidate: 30 }
);

/** Agent list for control tower — includes funnelStage and description (60s TTL). */
export const getCachedControlTowerAgents = unstable_cache(
  () =>
    prisma.agent.findMany({
      select: { id: true, name: true, description: true, status: true, funnelStage: true },
      orderBy: { updatedAt: "desc" },
    }),
  ["control-tower-agents"],
  { tags: ["agents"], revalidate: 60 }
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
  { tags: ["personas"], revalidate: 300 }
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
  { tags: ["personas"], revalidate: 60 }
);

// ── Dashboard counts ──────────────────────────────────────────────────────────

/** Aggregate counts shown in dashboard metric cards (60s TTL — near-real-time). */
export const getCachedDashboardCounts = unstable_cache(
  async () => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [sentLast24h, totalDecisions, totalConversions, trackedUsers] = await Promise.all([
      prisma.userDecision.count({ where: { sentAt: { gte: twentyFourHoursAgo } } }),
      prisma.userDecision.count(),
      prisma.userDecision.count({ where: { conversionAt: { not: null } } }),
      prisma.trackedUser.count(),
    ]);
    return { sentLast24h, totalDecisions, totalConversions, trackedUsers };
  },
  ["dashboard-counts"],
  { tags: ["dashboard-stats"], revalidate: 60 }
);

// ── Dashboard time-series and recent-sends ────────────────────────────────────

/**
 * 7-day decision rows for the dashboard conversion-rate chart (60s TTL).
 * Dates are pre-serialized to ISO strings — same rationale as getCachedChartDecisions.
 */
export const getCachedDashboardTimeSeries = unstable_cache(
  async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await prisma.userDecision.findMany({
      where: { sentAt: { gte: sevenDaysAgo } },
      select: { sentAt: true, conversionAt: true },
      take: 50000,
    });
    return rows.map((r) => ({
      sentAt: r.sentAt.toISOString(),
      conversionAt: r.conversionAt?.toISOString() ?? null,
    }));
  },
  ["dashboard-timeseries"],
  { tags: ["dashboard-stats"], revalidate: 60 }
);

/** Last 10 decisions for the dashboard recent-sends feed (30s TTL). */
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
  { tags: ["dashboard-stats"], revalidate: 30 }
);

// ── Performance page data ─────────────────────────────────────────────────────

/** Per-agent send/conversion aggregates for the last 30 days (5-min TTL). */
export const getCachedPerformanceMetrics = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [agents, sendsByAgent, conversionsByAgent] = await Promise.all([
      prisma.agent.findMany({
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
    ]);
    return { agents, sendsByAgent, conversionsByAgent };
  },
  ["performance-metrics"],
  { tags: ["performance"], revalidate: 300 }
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
  { tags: ["performance"], revalidate: 300 }
);

/**
 * Raw 30-day decision rows for timeseries/heatmap charts.
 * Most expensive query in the app — scans up to 50k rows.
 * 5-min TTL keeps chart rendering fast on cache miss windows.
 *
 * Dates are pre-serialized to ISO strings so that JSON cache serialization
 * (unstable_cache stores via JSON.stringify) doesn't silently convert Date
 * objects to strings that then break .toISOString() / .getUTCHours() calls
 * in the consumer.
 */
export const getCachedChartDecisions = unstable_cache(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.userDecision.findMany({
      where: { sentAt: { gte: thirtyDaysAgo } },
      select: { sentAt: true, conversionAt: true, reward: true },
      take: 50000,
    });
    return rows.map((r) => ({
      sentAt: r.sentAt.toISOString(),
      conversionAt: r.conversionAt?.toISOString() ?? null,
      reward: r.reward,
    }));
  },
  ["chart-decisions"],
  { tags: ["performance"], revalidate: 300 }
);

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

// ── Control Tower stats ───────────────────────────────────────────────────────

/** Aggregate counts for the control tower page (60s TTL). */
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
  { tags: ["dashboard-stats", "agents", "personas"], revalidate: 60 }
);
