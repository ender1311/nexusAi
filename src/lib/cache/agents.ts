/**
 * Agent-scoped `unstable_cache` wrappers.
 * See ./index.ts for the tag taxonomy.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { TTL } from "./ttl";

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
    { tags: [`agent-${id}`, "agents"], revalidate: TTL.STANDARD }
  )();
}

/**
 * Delivered vs still-pending decision counts for one agent.
 * Split because the raw _count.decisions lumps future-scheduled in_local_time
 * sends in with delivered ones, making a freshly scheduled agent look like
 * thousands already went out. Cached + tagged so the detail page can stream it
 * in its own Suspense boundary instead of blocking the shell.
 *
 * The 12h INTERVAL mirrors LOCAL_TIME_DELIVERY_BUFFER_MS / effectiveDeliveryDeadlineMs
 * (src/lib/agent-sends/pending-deadline.ts): an in_local_time send's scheduledFor is a
 * UTC anchor, but recipients receive it up to 12h later in their own timezone, so it
 * isn't "delivered" until that window closes.
 */
export function getCachedAgentDecisionSplit(id: string) {
  return unstable_cache(
    async () => {
      const rows = await prisma.$queryRaw<Array<{ delivered: bigint; pending: bigint }>>`
        SELECT
          COUNT(*) FILTER (
            WHERE "scheduledFor" IS NULL
              OR CASE
                   WHEN ("decisionContext"->>'inLocalTime')::boolean IS TRUE
                     THEN "scheduledFor" <= NOW() - INTERVAL '12 hours'
                   ELSE "scheduledFor" <= NOW()
                 END
          ) AS delivered,
          COUNT(*) FILTER (
            WHERE "scheduledFor" IS NOT NULL
              AND CASE
                    WHEN ("decisionContext"->>'inLocalTime')::boolean IS TRUE
                      THEN "scheduledFor" > NOW() - INTERVAL '12 hours'
                    ELSE "scheduledFor" > NOW()
                  END
          ) AS pending
        FROM "UserDecision"
        WHERE "agentId" = ${id}
      `;
      return {
        delivered: Number(rows[0]?.delivered ?? 0),
        pending: Number(rows[0]?.pending ?? 0),
      };
    },
    ["agent-decision-split", id],
    { tags: [`agent-${id}`, "dashboard-stats"], revalidate: TTL.STANDARD }
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
          select: { externalId: true, personaId: true },
          take: 20,
        }),
      ]);
      return { userCountRows, previewUsers };
    },
    ["agent-audience", agentId, key],
    { tags: [`agent-${agentId}`, "agents"], revalidate: TTL.STANDARD }
  )();
}

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
    { tags: ["agents"], revalidate: TTL.STANDARD }
  )
);

/** Agent list for control tower — includes funnelStage and description. */
export const getCachedControlTowerAgents = cache(unstable_cache(
  () =>
    prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      select: { id: true, name: true, description: true, status: true, funnelStage: true, color: true, sendingPaused: true },
      orderBy: { updatedAt: "desc" },
    }),
  ["control-tower-agents"],
  { tags: ["agents"], revalidate: TTL.STANDARD }
));

/**
 * Per-agent card stats for the agents list: unique-user counts and push
 * send/open counts. Cached together instead of running on every page request
 * (unstable_cache JSON-serializes, so bigint is materialized to Number here).
 *
 * Both UserDecision aggregates are scoped to the last 30 days (sentAt) and to
 * confirmed sends (brazeSendId IS NOT NULL) so the card numbers match the
 * per-agent performance page, which uses the same window/filter. Without the
 * brazeSendId filter "Reached" counted never-sent lottery rows (sentAt defaults
 * to now() at insert), and without the window the GROUP BY scanned the full
 * 19M+ row table. "Assigned" (active cohort) is current-state, so it is not
 * windowed.
 */
export const getCachedAgentCardStats = unstable_cache(
  async () => {
    const [uniqueUserRows, pushRows, assignedRows] = await Promise.all([
      prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
        SELECT "agentId", COUNT(DISTINCT "userId") AS cnt
        FROM "UserDecision"
        WHERE "brazeSendId" IS NOT NULL
          AND "sentAt" >= NOW() - INTERVAL '30 days'
        GROUP BY "agentId"
      `,
      prisma.$queryRaw<Array<{ agentId: string; sends: bigint; opens: bigint }>>`
        SELECT "agentId",
               COUNT(*) FILTER (
                 WHERE "channel" = 'push'
                   AND "brazeSendId" IS NOT NULL
                   AND (
                     "scheduledFor" IS NULL
                     OR CASE
                          WHEN ("decisionContext"->>'inLocalTime')::boolean IS TRUE
                            THEN "scheduledFor" <= NOW() - INTERVAL '12 hours'
                          ELSE "scheduledFor" <= NOW()
                        END
                   )
               ) AS sends,
               COUNT(*) FILTER (WHERE "channel" = 'push' AND "pushOpenAt" IS NOT NULL) AS opens
        FROM "UserDecision"
        WHERE "sentAt" >= NOW() - INTERVAL '30 days'
        GROUP BY "agentId"
      `,
      // Active cohort assignments (releasedAt IS NULL) per agent — "Assigned",
      // distinct from "Reached" (uniqueUsers = COUNT DISTINCT messaged users).
      prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
        SELECT "agentId", COUNT(*)::bigint AS cnt
        FROM "UserAgentAssignment"
        WHERE "releasedAt" IS NULL
        GROUP BY "agentId"
      `,
    ]);
    return {
      uniqueUsers: uniqueUserRows.map((r) => ({ agentId: r.agentId, count: Number(r.cnt) })),
      pushStats: pushRows.map((r) => ({ agentId: r.agentId, sends: Number(r.sends), opens: Number(r.opens) })),
      assigned: assignedRows.map((r) => ({ agentId: r.agentId, count: Number(r.cnt) })),
    };
  },
  ["agent-card-stats"],
  { tags: ["agents", "dashboard-stats"], revalidate: TTL.STANDARD }
);

/** Active cohort size (releasedAt IS NULL) for a single agent detail page. */
export function getCachedAgentAssignedCount(id: string) {
  return unstable_cache(
    () => prisma.userAgentAssignment.count({ where: { agentId: id, releasedAt: null } }),
    ["agent-assigned-count", id],
    { tags: [`agent-${id}`, "dashboard-stats"], revalidate: TTL.STANDARD }
  )();
}

/**
 * Kill-switch setting for global send pause. Tagged "lift-settings" so
 * KillSwitchToggle → POST /api/settings → revalidateTag("lift-settings") busts it
 * immediately on toggle. 60s TTL as a backstop for cold caches.
 */
export const getCachedKillSwitchSetting = cache(
  unstable_cache(
    () => prisma.appSetting.findUnique({ where: { key: "global_sending_paused" } }),
    ["kill-switch-setting"],
    { tags: ["lift-settings"], revalidate: 60 }
  )
);

/** All variant id+name pairs for display in performance tables. */
export const getCachedAllVariantNames = cache(
  unstable_cache(
    () => prisma.messageVariant.findMany({ select: { id: true, name: true } }),
    ["all-variant-names"],
    { tags: ["agents"], revalidate: TTL.STANDARD }
  )
);
