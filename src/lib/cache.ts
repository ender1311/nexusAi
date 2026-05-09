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
 */
export const getCachedChartDecisions = unstable_cache(
  () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return prisma.userDecision.findMany({
      where: { sentAt: { gte: thirtyDaysAgo } },
      select: { sentAt: true, conversionAt: true },
      take: 50000,
    });
  },
  ["chart-decisions"],
  { tags: ["performance"], revalidate: 300 }
);
