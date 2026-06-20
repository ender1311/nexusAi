import { prisma } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { withTimeout } from "@/lib/with-timeout";

/**
 * Aggregated giving profile of an agent's *active cohort* (assigned, not released),
 * derived from the giving attributes Hightouch syncs onto each TrackedUser
 * (gift_count_lifetime, gift_amount_lifetime, has_recurring_gift, gift_amount_maximum).
 *
 * This is the intrinsic giving capacity of the people an agent is working — distinct
 * from attributed conversions (gifts that landed in the window after a Nexus send).
 */
export type CohortGiving = {
  assigned: number; // active assignments (releasedAt IS NULL)
  givers: number; // cohort members with a lifetime gift on record
  recurringGivers: number; // cohort members flagged has_recurring_gift
  lifetimeGiftCount: number; // SUM(gift_count_lifetime) across the cohort
  lifetimeGivingReported: number; // SUM(gift_amount_lifetime) — reported amounts, mixed currency
  avgMaxGiftReported: number; // AVG(gift_amount_maximum) among givers — reported amounts
};

const EMPTY: CohortGiving = {
  assigned: 0,
  givers: 0,
  recurringGivers: 0,
  lifetimeGiftCount: 0,
  lifetimeGivingReported: 0,
  avgMaxGiftReported: 0,
};

// Numeric JSON attribute → float only when it looks like a number; NULL otherwise.
// Guards the aggregate from throwing on non-numeric / empty attribute values.
const num = (key: string) =>
  `CASE WHEN (u.attributes::jsonb->>'${key}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN (u.attributes::jsonb->>'${key}')::float END`;

async function queryCohortGiving(agentId: string): Promise<CohortGiving> {
  const rows = await prisma.$queryRawUnsafe<[{
    assigned: bigint;
    givers: bigint;
    recurring_givers: bigint;
    lifetime_gift_count: number | null;
    lifetime_giving_reported: number | null;
    avg_max_gift_reported: number | null;
  }]>(
    `SELECT
       COUNT(*)::bigint AS assigned,
       COUNT(*) FILTER (WHERE ${num("gift_count_lifetime")} > 0)::bigint                       AS givers,
       COUNT(*) FILTER (WHERE (u.attributes::jsonb->>'has_recurring_gift') = 'true')::bigint    AS recurring_givers,
       COALESCE(SUM(${num("gift_count_lifetime")}), 0)::float                                   AS lifetime_gift_count,
       COALESCE(SUM(${num("gift_amount_lifetime")}), 0)::float                                  AS lifetime_giving_reported,
       AVG(${num("gift_amount_maximum")}) FILTER (WHERE ${num("gift_count_lifetime")} > 0)       AS avg_max_gift_reported
     FROM "UserAgentAssignment" asg
     JOIN "User" u ON u."externalId" = asg."externalUserId"
     WHERE asg."agentId" = $1 AND asg."releasedAt" IS NULL`,
    agentId,
  );
  const r = rows[0];
  if (!r) return EMPTY;
  return {
    assigned: Number(r.assigned ?? 0),
    givers: Number(r.givers ?? 0),
    recurringGivers: Number(r.recurring_givers ?? 0),
    lifetimeGiftCount: Math.round(Number(r.lifetime_gift_count ?? 0)),
    lifetimeGivingReported: Number(r.lifetime_giving_reported ?? 0),
    avgMaxGiftReported: Number(r.avg_max_gift_reported ?? 0),
  };
}

/**
 * Cached + timeout-guarded cohort giving profile. The underlying query joins the
 * agent's active assignments to the (large) User table and parses giving attributes,
 * so it is wrapped in withTimeout to degrade gracefully on a cold cache.
 */
export async function agentCohortGiving(agentId: string): Promise<CohortGiving> {
  const cached = unstable_cache(
    () => queryCohortGiving(agentId),
    ["agent-cohort-giving", agentId],
    { tags: [`agent-${agentId}`], revalidate: 900 },
  );
  return withTimeout(cached(), 8000, EMPTY);
}
