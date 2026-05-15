/**
 * Shared `'use cache'` wrappers for expensive DB queries.
 *
 * Two-layer caching:
 *   ISR (`revalidate = 30` on pages) → CDN-cached HTML, <100ms on hit
 *   'use cache' here → server-side data cache; when ISR misses, re-render
 *   reads from here instead of hitting the DB (~50ms vs ~1.5s).
 *
 * Tag taxonomy:
 *   "agents"          — any agent mutation (create/update/delete)
 *   "agent-${id}"     — specific agent mutation
 *   "personas"        — persona changes
 *   "dashboard-stats" — new decisions recorded
 *   "performance"     — new decisions recorded
 */
import { cacheTag, cacheLife } from "next/cache";
import { prisma } from "@/lib/db";

// ── Agent data ───────────────────────────────────────────────────────────────

/** Full agent detail with all relations. Tagged for targeted invalidation. */
export async function getCachedAgent(id: string) {
  "use cache";
  cacheTag(`agent-${id}`, "agents");
  cacheLife({ revalidate: 30 });
  return prisma.agent.findUnique({
    where: { id },
    include: {
      goals: true,
      messages: { include: { variants: true } },
      schedulingRule: true,
      personaTargets: { include: { persona: true } },
      _count: { select: { decisions: true } },
    },
  });
}

/** Lightweight agent list for dashboard sidebar. */
export async function getCachedAgentList() {
  "use cache";
  cacheTag("agents");
  cacheLife({ revalidate: 30 });
  return prisma.agent.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { decisions: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// ── Persona data ─────────────────────────────────────────────────────────────

/** Active personas with minimal fields — used in dropdowns/selectors. */
export async function getCachedActivePersonas() {
  "use cache";
  cacheTag("personas");
  cacheLife({ revalidate: 300 });
  return prisma.persona.findMany({
    where: { isActive: true },
    select: { id: true, name: true, label: true, icon: true, color: true },
    orderBy: { name: "asc" },
  });
}

/** Persona distribution with user counts for the dashboard chart. */
export async function getCachedPersonaDistribution() {
  "use cache";
  cacheTag("personas");
  cacheLife({ revalidate: 60 });
  return prisma.persona.findMany({
    where: { isActive: true },
    select: { name: true, label: true, color: true, _count: { select: { trackedUsers: true } } },
    orderBy: { name: "asc" },
  });
}

// ── Dashboard counts ──────────────────────────────────────────────────────────

/** Aggregate counts shown in dashboard metric cards (60s TTL — near-real-time). */
export async function getCachedDashboardCounts() {
  "use cache";
  cacheTag("dashboard-stats");
  cacheLife({ revalidate: 60 });
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [sentLast24h, totalDecisions, totalConversions, trackedUsers] = await Promise.all([
    prisma.userDecision.count({ where: { sentAt: { gte: twentyFourHoursAgo } } }),
    prisma.userDecision.count(),
    prisma.userDecision.count({ where: { conversionAt: { not: null } } }),
    prisma.trackedUser.count(),
  ]);
  return { sentLast24h, totalDecisions, totalConversions, trackedUsers };
}

// ── Dashboard time-series and recent-sends ────────────────────────────────────

/**
 * 7-day decision rows for the dashboard conversion-rate chart (60s TTL).
 * Dates are pre-serialized to ISO strings — same rationale as getCachedChartDecisions.
 */
export async function getCachedDashboardTimeSeries() {
  "use cache";
  cacheTag("dashboard-stats");
  cacheLife({ revalidate: 60 });
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
}

/** Last 10 decisions for the dashboard recent-sends feed (30s TTL). */
export async function getCachedRecentDecisions() {
  "use cache";
  cacheTag("dashboard-stats");
  cacheLife({ revalidate: 30 });
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
}

// ── Performance page data ─────────────────────────────────────────────────────

/** Per-agent send/conversion aggregates for the last 30 days (5-min TTL). */
export async function getCachedPerformanceMetrics() {
  "use cache";
  cacheTag("performance");
  cacheLife({ revalidate: 300 });
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
}

/** Per-variant send/conversion/reward aggregates for the last 30 days. */
export async function getCachedVariantMetrics() {
  "use cache";
  cacheTag("performance");
  cacheLife({ revalidate: 300 });
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
}

/**
 * Raw 30-day decision rows for timeseries/heatmap charts.
 * Most expensive query in the app — scans up to 50k rows.
 * 5-min TTL keeps chart rendering fast on cache miss windows.
 *
 * Dates are pre-serialized to ISO strings so that JSON cache serialization
 * doesn't silently convert Date objects to strings that then break
 * .toISOString() / .getUTCHours() calls in the consumer.
 */
export async function getCachedChartDecisions() {
  "use cache";
  cacheTag("performance");
  cacheLife({ revalidate: 300 });
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
}

/**
 * Lift measurement configuration from AppSetting.
 * Cached for 24h — tag-invalidated by the settings API on save.
 * Returns defaults (1.2% baseline, null since date) when keys are absent.
 */
export async function getCachedLiftSettings() {
  "use cache";
  cacheTag("lift-settings");
  cacheLife({ revalidate: 86400 });
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
}

// ── Control Tower data ───────────────────────────────────────────────────────

/** Agent list for control tower — includes funnelStage and description (60s TTL). */
export async function getCachedControlTowerAgents() {
  "use cache";
  cacheTag("agents");
  cacheLife({ revalidate: 60 });
  return prisma.agent.findMany({
    select: { id: true, name: true, description: true, status: true, funnelStage: true },
    orderBy: { updatedAt: "desc" },
  });
}

// ── Control Tower stats ───────────────────────────────────────────────────────

/** Aggregate counts for the control tower page (60s TTL). */
export async function getCachedControlTowerStats() {
  "use cache";
  cacheTag("dashboard-stats", "agents", "personas");
  cacheLife({ revalidate: 60 });
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
}
