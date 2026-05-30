import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { randomUUID } from "crypto";
import {
  getCachedDashboardCounts,
  getCachedDashboardTimeSeries,
  getCachedAgentList,
  getCachedPerformanceMetrics,
  getCachedSegments,
} from "@/lib/cache";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
import { buildAgentLottery } from "@/lib/engine/agent-lottery";
import { getTodayStartUTC, computeScheduledAt, peakActivityHour, isInQuietHours, isBlackoutDate }  from "@/lib/engine/scheduling";
import { isTimingMatch } from "@/lib/engine/send-timing";
import { LinUCB } from "@/lib/engine/linucb";
import { selectVariant, blendArm } from "@/lib/engine/select-variant";
import { parseFrequencyCap, parseQuietHours } from "@/lib/schemas/scheduling";
import { computeFeatureVector, FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { BanditArm } from "@/lib/engine/types";
import { recencyMultiplier } from "@/lib/engine/beta-pdf";
import { buildEligibleAgentsByUser, classifyExplorationWindows } from "@/lib/cron/exploration-window";
import { selectAudience, trimToCap } from "@/lib/cron/caps";
import {
  groupDecisionsByVariant,
  dispatchSendGroups,
  type VariantSendGroup,
} from "@/lib/cron/send-grouping";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback for cron
  return token === secret;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Concurrency lock — prevent duplicate runs if cron invokes before previous run completes.
  // Single atomic INSERT ON CONFLICT eliminates the read-then-write race window.
  // rowsAffected === 0 means the existing lock is fresh (< 290s old) → another run is active.
  const lockKey = "cron_lock_select_and_send";
  const lockId  = randomUUID();
  const lockTs  = new Date().toISOString();
  const lockAcquired = await prisma.$executeRaw`
    INSERT INTO "AppSetting" (id, key, value)
    VALUES (${lockId}, ${lockKey}, ${lockTs})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value
      WHERE (EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM "AppSetting".value::timestamptz)) > 290
  `;
  if (lockAcquired === 0) {
    return NextResponse.json({ error: "Already running" }, { status: 409 });
  }

  const cronRun = await prisma.cronRun.create({
    data: { cronName: "select-and-send", agentCount: 0 },
  });
  const cronRunId = cronRun.id;

  try {

  const brazeClient = createBrazeClient();
  if (!brazeClient) {
    await prisma.cronRun.update({
      where: { id: cronRunId },
      data: { status: "failed", finishedAt: new Date(), errorMsg: "Braze not configured" },
    }).catch(() => {});
    return NextResponse.json({ error: "Braze not configured (missing BRAZE_API_KEY or BRAZE_REST_URL)" }, { status: 500 });
  }

  const factory = new PayloadFactory();
  let totalSent = 0;
  let totalSuppressed = 0;
  let totalErrors = 0;

  const agents = await prisma.agent.findMany({
    where: { status: "active" },
    include: {
      personaTargets: true,
      schedulingRule: true,
      messages: {
        include: {
          variants: { where: { status: "active" } },
        },
      },
    },
  });

  void prisma.cronRun.update({
    where: { id: cronRunId },
    data: { agentCount: agents.length },
  }).catch(() => {});

  const now = new Date();   // single timestamp for the entire cron run
  const todayStart = getTodayStartUTC("America/New_York", now);

  // ── Pre-assignment phase: build lottery map once for the entire cron run ──
  // Fetch eligible user IDs for all agents in parallel (one query per agent),
  // and also fetch the cooldown setting for Phase 0 in the same round trip.
  const eligibleUsersByAgent = new Map<string, string[]>();
  // preferredHourByAgent: agentId → Map<externalId, preferredSendHour | null>
  // Used by time-bucketed audience selection when prioritizeLastSeen is on.
  const preferredHourByAgent = new Map<string, Map<string, number | null>>();
  const [, cooldownSetting] = await Promise.all([
    Promise.all(
      agents.map(async (agent) => {
        const personaIds = agent.personaTargets.map((pt) => pt.personaId);
        if (personaIds.length === 0) {
          eligibleUsersByAgent.set(agent.id, []);
          return;
        }
        // Language filter: only apply DB-level filter when agent has an explicit setting.
        // Push agent language filtering (defaulting to "en") is done in-memory to avoid
        // JSONB path filter reliability issues with the Neon HTTP adapter.
        const langFilter = agent.languageFilter && agent.languageFilter !== "all"
          ? { attributes: { path: ["language_tag"], string_starts_with: agent.languageFilter } }
          : {};

        // Staleness gate: only target users whose funnelStage was confirmed by Hightouch
        // within the agent's configured window. Lapsed agents use a long window (e.g. 14 days)
        // so users who graduate out of lapsed are still reachable for a while; tight-window
        // agents (wau, connected) auto-exclude stale rows after ~2 days.
        // null = no gate (backward compat for agents created before this field existed).
        const staleAt = agent.staleFunnelStageDays
          ? new Date(now.getTime() - agent.staleFunnelStageDays * 86_400_000)
          : null;
        const funnelFilter = agent.funnelStage
          ? {
              funnelStage: agent.funnelStage,
              ...(staleAt && { funnelStageUpdatedAt: { gte: staleAt } }),
            }
          : {};
        const segTargeting = agent.segmentTargeting as { includes?: string[]; excludes?: string[] } | null;
        const effectiveIncludes: string[] = segTargeting?.includes?.length
          ? segTargeting.includes
          : agent.targetSegmentName
            ? [agent.targetSegmentName]
            : [];
        const effectiveExcludes: string[] = segTargeting?.excludes ?? [];

        // Only called when effectiveExcludes.length > 0
        const fetchExcludedIds = async (): Promise<Set<string>> => {
          const rows = await prisma.userSegment.findMany({
            where: { segmentName: { in: effectiveExcludes } },
            select: { externalId: true },
          });
          return new Set(rows.map((r) => r.externalId));
        };

        if (effectiveIncludes.length > 0) {
          // Fetch all include segments in parallel, then intersect (AND logic)
          const memberSets = await Promise.all(
            effectiveIncludes.map((seg) =>
              prisma.userSegment.findMany({
                where: { segmentName: seg },
                select: { externalId: true },
              }).then((rows) => new Set(rows.map((r) => r.externalId)))
            )
          );
          // AND intersection: user must be in all include segments
          let memberIds = [...memberSets[0]];
          for (let i = 1; i < memberSets.length; i++) {
            memberIds = memberIds.filter((id) => memberSets[i].has(id));
          }
          if (memberIds.length === 0) {
            eligibleUsersByAgent.set(agent.id, []);
            return;
          }
          // Apply excludes
          if (effectiveExcludes.length > 0) {
            const excludedIds = await fetchExcludedIds();
            memberIds = memberIds.filter((id) => !excludedIds.has(id));
            if (memberIds.length === 0) {
              eligibleUsersByAgent.set(agent.id, []);
              return;
            }
          }
          const rows = await prisma.trackedUser.findMany({
            where: {
              externalId: { in: memberIds },
              personaId:  { in: personaIds },
              OR: [
                { lockedByAgentId: null },
                { lockedByAgentId: agent.id },
              ],
            },
            select: { externalId: true, preferredSendHour: true },
          });
          eligibleUsersByAgent.set(agent.id, rows.map((r) => r.externalId));
          preferredHourByAgent.set(
            agent.id,
            new Map(rows.map((r) => [r.externalId, r.preferredSendHour])),
          );
        } else {
          // Funnel-stage path (existing logic + exclude support)
          // Bound the query so agents with millions of eligible users don't load the
          // entire set into memory. audienceCap is the hard per-run limit; when unset,
          // derive a safe fetch window from dailySendCap (2× for suppression headroom).
          // Without at least one cap an agent targeting 7M+ users would exhaust the
          // 300s function timeout before processing a single send.
          const fetchLimit =
            agent.audienceCap ??
            (agent.dailySendCap != null ? agent.dailySendCap * 2 : undefined);
          let rows = await prisma.trackedUser.findMany({
            where:  {
              personaId: { in: personaIds },
              ...langFilter,
              ...funnelFilter,
              OR: [
                { lockedByAgentId: null },
                { lockedByAgentId: agent.id },
              ],
            },
            select: { externalId: true, preferredSendHour: true },
            ...(fetchLimit !== undefined ? { take: fetchLimit } : {}),
          });
          // Apply excludes to funnel-stage path
          if (effectiveExcludes.length > 0) {
            const excludedIds = await fetchExcludedIds();
            rows = rows.filter((r) => !excludedIds.has(r.externalId));
          }
          eligibleUsersByAgent.set(agent.id, rows.map((r) => r.externalId));
          preferredHourByAgent.set(
            agent.id,
            new Map(rows.map((r) => [r.externalId, r.preferredSendHour])),
          );
        }
      })
    ),
    // ─── Phase 0 setup: fetch cooldown config in parallel with lottery queries ───
    prisma.appSetting.findUnique({ where: { key: "exploration_window_cooldown_days" } }),
  ]);

  const lotteryMap = buildAgentLottery(eligibleUsersByAgent);
  // lotteryMap: Map<externalUserId, agentId>  — held in memory for this run
  // ── End pre-assignment phase ──────────────────────────────────────────────

  // ─── Phase 0: Exploration window assignment ───────────────────────────────
  // Identify lapsed/connected users, create/classify their assignments,
  // and build inWindowMap (externalUserId → agentId) for this cron run.
  const cooldownDays = cooldownSetting ? parseInt(cooldownSetting.value, 10) : 90;
  const cooldownMs   = cooldownDays * 86_400_000;
  const windowMs     = 8 * 86_400_000;

  const explorationAgents = agents.filter(
    (a) => a.funnelStage === "lapsed" || a.funnelStage === "connected"
  );

  const inWindowMap = new Map<string, string>(); // externalUserId → agentId

  if (explorationAgents.length > 0) {
    const explorationPersonaIds = [
      ...new Set(explorationAgents.flatMap((a) => a.personaTargets.map((pt) => pt.personaId))),
    ];

    // Run user fetch and assignment fetch in parallel.
    // We use a broad assignment query (all exploration agents) since we can't
    // know user externalIds until explorationUsers resolves; instead we filter
    // by agentId to limit scope, then reconcile after both resolve.
    const [explorationUsers, existingAssignments] = await Promise.all([
      prisma.trackedUser.findMany({
        where: { personaId: { in: explorationPersonaIds } },
      }),
      prisma.userAgentAssignment.findMany({
        where: { agentId: { in: explorationAgents.map((a) => a.id) } },
      }),
    ]);
    const assignmentByUser = new Map(existingAssignments.map((a) => [a.externalUserId, a]));

    const eligibleAgentsByUser = buildEligibleAgentsByUser(explorationAgents, explorationUsers);
    const classification = classifyExplorationWindows(
      explorationUsers,
      assignmentByUser,
      eligibleAgentsByUser,
      { now, windowMs, cooldownMs },
    );
    const { toCreate, toReset, toClose } = classification;
    for (const [uid, aid] of classification.inWindowMap) inWindowMap.set(uid, aid);

    // Apply DB writes:
    // Class A — single createMany (1 round trip for any number of new users)
    if (toCreate.length > 0) {
      await prisma.userAgentAssignment.createMany({
        data: toCreate.map(({ externalUserId, agentId }) => ({
          externalUserId, agentId, sendCount: 0, windowCompletedAt: null,
        })),
        skipDuplicates: true,
      });
    }
    // Class D — parallel upserts (reset per-user with possibly different agentId)
    if (toReset.length > 0) {
      await Promise.all(
        toReset.map(({ externalUserId, agentId }) =>
          prisma.userAgentAssignment.update({
            where: { externalUserId },
            data: { agentId, startedAt: now, sendCount: 0, windowCompletedAt: null },
          })
        )
      );
    }
    if (toClose.length > 0) {
      await prisma.userAgentAssignment.updateMany({
        where: { id: { in: toClose } },
        data: { windowCompletedAt: now },
      });
    }
  }
  // ─── End Phase 0 ─────────────────────────────────────────────────────────────

  // Derived once from inWindowMap — used in every agent's user query
  const inWindowUserIdSet = new Set(inWindowMap.keys());

  // Per-agent metric accumulators for ModelMetric writes
  const agentMetrics = new Map<string, { sent: number; suppressed: number; errors: number }>();

  for (const agent of agents) {
    const metricsBefore = { sent: totalSent, suppressed: totalSuppressed, errors: totalErrors };
    const personaIds = agent.personaTargets.map((pt) => pt.personaId);
    if (personaIds.length === 0) continue;
    const suppress = { freqCap: 0, smartSuppress: 0, dailyCap: 0, quietHours: 0, targetFilter: 0, audienceCap: 0, uniqueUsersCap: 0, blackout: 0 };

    // Derive the users assigned to this agent by the lottery
    const assignedUserIds = [...lotteryMap.entries()]
      .filter(([, aid]) => aid === agent.id)
      .map(([uid]) => uid);

    // Exclude in-window users from lottery pipeline (they're handled separately below)
    let lotteryUserIds = assignedUserIds.filter((id) => !inWindowUserIdSet.has(id));

    // Apply audience cap — time-bucketed selection when prioritizeLastSeen is on (default),
    // otherwise fall back to Fisher-Yates random shuffle.
    if (agent.audienceCap !== null && agent.audienceCap !== undefined) {
      const selection = selectAudience(lotteryUserIds, {
        audienceCap: agent.audienceCap,
        prioritizeLastSeen: agent.schedulingRule?.prioritizeLastSeen !== false,
        currentHour: now.getUTCHours(),
        preferredHourByUser: preferredHourByAgent.get(agent.id) ?? new Map<string, number | null>(),
      });
      lotteryUserIds = selection.kept;
      suppress.audienceCap = selection.suppressed;
    }

    // Daily send cap — stop / trim when the agent has already hit its daily limit.
    // Counts only confirmed sends (brazeSendId set) to avoid counting Braze-failed attempts.
    if (agent.dailySendCap != null) {
      const sentToday = await prisma.userDecision.count({
        where: {
          agentId:     agent.id,
          sentAt:      { gte: todayStart },
          brazeSendId: { not: null },
        },
      });
      const trimmed = trimToCap(lotteryUserIds, agent.dailySendCap - sentToday);
      lotteryUserIds = trimmed.kept;
      suppress.dailyCap += trimmed.suppressed;
    }

    // Lifetime unique users cap — stop sends when the agent has reached its ceiling of
    // distinct users ever targeted. Uses COUNT(DISTINCT) over all UserDecision rows.
    if (agent.uniqueUsersCap != null) {
      const rows = await prisma.$queryRaw<[{ n: bigint }]>`
        SELECT COUNT(DISTINCT "userId")::bigint AS n FROM "UserDecision" WHERE "agentId" = ${agent.id}
      `;
      const alreadyReached = Number(rows[0]?.n ?? 0);
      const trimmed = trimToCap(lotteryUserIds, agent.uniqueUsersCap - alreadyReached);
      lotteryUserIds = trimmed.kept;
      suppress.uniqueUsersCap += trimmed.suppressed;
    }

    // Lock lottery users to this agent — prevents other agents from grabbing them
    // in subsequent cron runs. Locks are released when the agent is paused or deleted.
    // Condition: only lock users not already locked by another agent (idempotency).
    if (lotteryUserIds.length > 0) {
      await prisma.trackedUser.updateMany({
        where: { externalId: { in: lotteryUserIds }, lockedByAgentId: null },
        data:  { lockedByAgentId: agent.id },
      });
    }

    // Check if this agent has any in-window users to process
    const hasInWindowUsers = [...inWindowMap.entries()].some(([, aid]) => aid === agent.id);

    // If no lottery users and no in-window users, skip agent entirely
    if (lotteryUserIds.length === 0 && !hasInWindowUsers) continue;

    // Build variant detail lookup: variantId → { channel, body, title, deeplink, brazeCampaignId, brazeVariantId }
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      deeplink: string | null;
      brazeCampaignId: string | null;
      brazeVariantId: string | null;
    }>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        variantMeta.set(v.id, {
          channel:         msg.channel,
          body:            v.body,
          title:           v.title ?? null,
          deeplink:        v.deeplink ?? null,
          brazeCampaignId: msg.brazeCampaignId ?? null,
          brazeVariantId:  v.brazeVariantId ?? null,
        });
      }
    }

    // Evaluate agent-level scheduling checks once (not per user)
    const rule = agent.schedulingRule;

    // Resolve quiet hours mode (backward compat: timezone==="user" → schedule, any tz → suppress, absent → none)
    const quietHoursRaw = parseQuietHours(rule?.quietHours);
    const qhMode = quietHoursRaw?.mode ?? (quietHoursRaw?.timezone === "user" ? "schedule" : quietHoursRaw ? "suppress" : "none");
    const quietHoursConfig = qhMode === "suppress" ? quietHoursRaw : null;
    const scheduleDeliverHour = qhMode === "schedule" ? (quietHoursRaw?.deliverAtHour ?? 8) : null;

    // Global blackout calendar dates ("YYYY-MM-DD") on which no send may be scheduled.
    const blackoutDatesRaw = rule?.blackoutDates;
    const blackoutDates: string[] = Array.isArray(blackoutDatesRaw)
      ? blackoutDatesRaw.filter((d): d is string => typeof d === "string")
      : [];

    // Pre-seed PersonaArmStats for all persona × variant combinations so
    // concurrent decideForUser calls don't race on the upsert — run in parallel.
    const allVariantIds = agent.messages.flatMap((m) => m.variants.map((v) => v.id));
    const initialAlpha = agent.algorithm !== "linucb" ? 1 : 0;
    const initialBeta  = agent.algorithm !== "linucb" ? 30 : 0;
    await Promise.all(
      personaIds.flatMap((personaId) =>
        allVariantIds.map((variantId) =>
          prisma.personaArmStats.upsert({
            where: { personaId_agentId_variantId: { personaId, agentId: agent.id, variantId } },
            create: { personaId, agentId: agent.id, variantId, alpha: initialAlpha, beta: initialBeta, tries: 0, wins: 0 },
            update: {},
          })
        )
      )
    );

    // Seed LinUCBArm identity rows for each variant so cold-start LinUCB agents can select.
    if (agent.algorithm === "linucb") {
      const fresh = new LinUCB().initialArm(FEATURE_DIM);
      await Promise.all(
        allVariantIds.map((variantId) =>
          prisma.linUCBArm.upsert({
            where: { agentId_variantId: { agentId: agent.id, variantId } },
            create: {
              agentId: agent.id,
              variantId,
              aInv: fresh.aInv as unknown as Prisma.InputJsonValue,
              b: fresh.b as unknown as Prisma.InputJsonValue,
              tries: 0,
            },
            update: {}, // never overwrite existing learned state
          })
        )
      );
    }

    // For LinUCB: load per-agent LinUCB arms once before the page loop (arms are keyed by agentId,
    // constant for the whole run, and stale-reset has already fired). Re-loading every page is wasteful.
    const linucbArmsByVariant: Map<string, { id: string; aInv: number[]; b: number[] }> = new Map();
    if (agent.algorithm === "linucb" && lotteryUserIds.length > 0) {
      const freshArm = new LinUCB().initialArm(FEATURE_DIM);
      const allArms = await prisma.linUCBArm.findMany({ where: { agentId: agent.id, variantId: { in: allVariantIds } } });
      const staleArms = allArms.filter(
        (r) =>
          !(Array.isArray(r.aInv) && (r.aInv as number[]).length === FEATURE_DIM * FEATURE_DIM) ||
          !(Array.isArray(r.b) && (r.b as number[]).length === FEATURE_DIM)
      );
      if (staleArms.length > 0) {
        await Promise.all(
          staleArms.map((r) =>
            prisma.linUCBArm.update({
              where: { agentId_variantId: { agentId: r.agentId, variantId: r.variantId } },
              data: {
                aInv: freshArm.aInv as unknown as Prisma.InputJsonValue,
                b: freshArm.b as unknown as Prisma.InputJsonValue,
                tries: 0,
              },
            })
          )
        );
      }
      const staleIds = new Set(staleArms.map((s) => s.variantId));
      for (const r of allArms) {
        const isStale = staleIds.has(r.variantId);
        const aInv = isStale ? freshArm.aInv : (r.aInv as number[]);
        const b = isStale ? freshArm.b : (r.b as number[]);
        linucbArmsByVariant.set(r.variantId, { id: r.variantId, aInv, b });
      }
    }

    // Page through users in this agent's target personas (500 at a time).
    // Skip the loop entirely when there are no lottery users to avoid a wasted DB round trip.
    let cursor: string | undefined;
    while (lotteryUserIds.length > 0) {
      const users = await prisma.trackedUser.findMany({
        where: {
          personaId:  { in: personaIds },
          externalId: { in: lotteryUserIds },
        },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      const userExternalIds = users.map((u) => u.externalId);

      // 4b. Bulk frequency cap check and 4d. Global daily cap — run in parallel (independent reads)
      const freqCap = parseFrequencyCap(rule?.frequencyCap);
      const hasLotteryFreqCap = rule && typeof freqCap?.maxSends === "number";
      const lotteryPeriodMs: Record<string, number> = {
        day:    86_400_000,
        week:   7  * 86_400_000,
        biweek: 14 * 86_400_000,
        month:  30 * 86_400_000,
      };
      const lotteryFreqWindowStart = hasLotteryFreqCap
        ? new Date(now.getTime() - (lotteryPeriodMs[freqCap!.period ?? "week"] ?? lotteryPeriodMs.week))
        : null;

      const [lotteryRecentDecisions, sentTodayRows, recentSendsByUser] = await Promise.all([
        hasLotteryFreqCap
          ? prisma.userDecision.groupBy({
              by: ["userId"],
              where: {
                agentId: agent.id,
                userId:  { in: userExternalIds },
                sentAt:  { gte: lotteryFreqWindowStart! },
              },
              _count: { userId: true },
            })
          : Promise.resolve([] as Array<{ userId: string; _count: { userId: number } }>),
        // 4d. Global daily cap — cross-agent guard (no agentId filter intentional).
        // Only count confirmed sends (brazeSendId set) — phantom decisions where
        // the Braze API call failed should not block the user from being retried.
        prisma.userDecision.findMany({
          where: {
            userId: { in: userExternalIds },
            sentAt: { gte: todayStart },
            brazeSendId: { not: null },
            // intentionally no agentId filter — cross-agent
          },
          select:   { userId: true },
          distinct: ["userId"],
        }),
        // Recency penalty: most recent send per (userId, variantId) in last 7 days
        prisma.userDecision.findMany({
          where: {
            agentId:  agent.id,
            userId:   { in: userExternalIds },
            sentAt:   { gte: new Date(now.getTime() - 7 * 86_400_000) },
            messageVariantId: { not: null },
          },
          select: { userId: true, messageVariantId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
        }),
      ]);

      const freqCappedUserIds = new Set<string>();
      if (hasLotteryFreqCap) {
        const countByUser = new Map(lotteryRecentDecisions.map((r) => [r.userId, r._count.userId]));
        for (const u of users) {
          const count = countByUser.get(u.externalId) ?? 0;
          if (count >= freqCap!.maxSends!) {
            freqCappedUserIds.add(u.externalId);
          }
        }
      }
      const sentTodayIds = new Set(sentTodayRows.map((r) => r.userId));

      // 4c. Smart suppression — filter out chronically low-reward users using already-loaded user data
      const smartSuppressedUserIds = new Set<string>();
      if (rule?.smartSuppress) {
        for (const u of users) {
          if (u.totalDecisions >= 5) {
            const avgReward = u.totalReward / u.totalDecisions;
            if (avgReward < -rule.suppressThresh) {
              smartSuppressedUserIds.add(u.externalId);
            }
          }
        }
      }

      // 4d. Quiet hours — per user, using the user's own timezone from attributes.
      // Falls back to the agent's configured timezone when the user has none stored.
      const quietHoursUserIds = new Set<string>();
      if (quietHoursConfig?.start && quietHoursConfig?.end) {
        const agentTz = quietHoursConfig.timezone ?? "UTC";
        for (const u of users) {
          const attrs = u.attributes as Record<string, unknown>;
          const userTz = typeof attrs?.timezone === "string" ? attrs.timezone : agentTz;
          if (isInQuietHours(quietHoursConfig.start, quietHoursConfig.end, userTz, now)) {
            quietHoursUserIds.add(u.externalId);
          }
        }
      }

      // Count suppressed users (freq cap + smart suppress + global daily cap + quiet hours)
      for (const u of users) {
        const isFreqCapped  = freqCappedUserIds.has(u.externalId);
        const isSmartSup    = smartSuppressedUserIds.has(u.externalId);
        const isDailyCapped = sentTodayIds.has(u.externalId);
        const isQuietHours  = quietHoursUserIds.has(u.externalId);
        if (isFreqCapped || isSmartSup || isDailyCapped || isQuietHours) {
          totalSuppressed++;
          if (isFreqCapped)  suppress.freqCap++;
          if (isSmartSup)    suppress.smartSuppress++;
          if (isDailyCapped) suppress.dailyCap++;
          if (isQuietHours)  suppress.quietHours++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) =>
          !freqCappedUserIds.has(u.externalId) &&
          !smartSuppressedUserIds.has(u.externalId) &&
          !sentTodayIds.has(u.externalId) &&
          !quietHoursUserIds.has(u.externalId)
      );

      // Channel eligibility: newsletter_push_enabled / newsletter_email_enabled must not be
      // explicitly false. Absent or true = eligible (opt-out model; HT default: true).
      // Checked in-memory (JSONB boolean comparison via Prisma path filter is fragile).
      const hasPushMessages = agent.messages.some((m) => m.channel === "push");
      const hasEmailMessages = agent.messages.some((m) => m.channel === "email");
      const channelFiltered = eligibleUsers.filter((u) => {
        const attrs = u.attributes as Record<string, unknown>;
        if (hasPushMessages && attrs?.newsletter_push_enabled === false) return false;
        if (hasEmailMessages && attrs?.newsletter_email_enabled === false) return false;
        return true;
      });
      suppress.targetFilter += eligibleUsers.length - channelFiltered.length;

      // Language filter for push agents: English-only sends by default.
      // Checked in-memory for reliability (JSONB path filter is fragile with Neon HTTP adapter).
      const effectiveAgentLang =
        agent.languageFilter && agent.languageFilter !== "all"
          ? agent.languageFilter
          : hasPushMessages ? "en" : null;
      const langFiltered = effectiveAgentLang
        ? channelFiltered.filter((u) => {
            const attrs = u.attributes as Record<string, unknown>;
            const lang = attrs?.language_tag as string | undefined;
            return lang?.startsWith(effectiveAgentLang) === true;
          })
        : channelFiltered;
      suppress.targetFilter += channelFiltered.length - langFiltered.length;

      // Apply targetFilter in-memory on the already-loaded page (V1: no SQL-side JSON filtering)
      const targetFiltered = langFiltered.filter((u) => {
        if (!agent.targetFilter) return true;
        return evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
          attributes: u.attributes as Record<string, unknown>,
          computed: buildComputedKeys(u),
        });
      });
      suppress.targetFilter += langFiltered.length - targetFiltered.length;

      const quietFiltered = targetFiltered;

      // Batch-decide for lottery users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createManyAndReturn call.
      let byVariant: Record<string, VariantSendGroup> = {};

      if (quietFiltered.length > 0) {
        // Collect unique personaIds among eligible users
        const pagePersonaIds = [...new Set(
          quietFiltered.map((u) => u.personaId).filter(Boolean) as string[]
        )];

        // Load all arm stats for this agent × page personas in one query
        const pageArmStatsRows = await prisma.personaArmStats.findMany({
          where: {
            agentId:   agent.id,
            personaId: { in: pagePersonaIds },
            variantId: { in: allVariantIds },
          },
        });

        // Index: personaId → variantId → BanditArm
        const pageArmsByPersona = new Map<string, Map<string, BanditArm>>();
        for (const row of pageArmStatsRows) {
          if (!pageArmsByPersona.has(row.personaId)) {
            pageArmsByPersona.set(row.personaId, new Map());
          }
          pageArmsByPersona.get(row.personaId)!.set(row.variantId, { id: row.variantId, stats: row });
        }

        // Load per-user arm stats for personalised blending (Thompson/EpsilonGreedy only)
        const pageUserIds = quietFiltered.map((u) => u.externalId);
        const pageUserArmRows = agent.algorithm !== "linucb"
          ? await prisma.userArmStats.findMany({
              where: { userId: { in: pageUserIds }, agentId: agent.id, variantId: { in: allVariantIds } },
            })
          : [];
        // Index: userId → variantId → {alpha,beta,tries,wins}
        const userArmsByUser = new Map<string, Map<string, typeof pageUserArmRows[number]>>();
        for (const row of pageUserArmRows) {
          if (!userArmsByUser.has(row.userId)) userArmsByUser.set(row.userId, new Map());
          userArmsByUser.get(row.userId)!.set(row.variantId, row);
        }

        // Variants with channel for in-memory selection
        const pageVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const lotteryDecisionInputs: Array<{ user: typeof quietFiltered[number]; variantId: string; scheduledAt: Date; inLocalTime: boolean; contextVector?: number[] }> = [];
        for (const user of quietFiltered) {
          const pid = user.personaId as string | null;
          if (!pid) continue;

          // Build recency penalty map for this user
          const userRecent = recentSendsByUser.filter((r) => r.userId === user.externalId);
          const recencyPenalties: Record<string, number> = {};
          for (const r of userRecent) {
            const vid = r.messageVariantId;
            if (!vid || recencyPenalties[vid] !== undefined) continue; // keep most recent only
            const daysSince = (now.getTime() - r.sentAt.getTime()) / 86_400_000;
            recencyPenalties[vid] = recencyMultiplier(daysSince);
          }

          let selectedVariantId: string;
          // Hoisted so decisionContext can include it for LinUCB reward path
          let lotteryContextVector: number[] | undefined;

          if (agent.algorithm === "linucb") {
            // LinUCB: select variant from the user's feature context
            const linucbArms = pageVariants
              .map((v) => linucbArmsByVariant.get(v.id))
              .filter(Boolean) as Array<{ id: string; aInv: number[]; b: number[] }>;
            if (linucbArms.length === 0) continue;

            // Use stored feature vector only if it matches the current FEATURE_DIM;
            // stale vectors from the old 44-dim layout are recomputed on the fly.
            const storedVec = user.featureVector as number[];
            const context: number[] =
              Array.isArray(storedVec) && storedVec.length === FEATURE_DIM
                ? storedVec
                : computeFeatureVector({
                    totalDecisions:   user.totalDecisions,
                    totalConversions: user.totalConversions,
                    totalReward:      user.totalReward,
                    channelStats:     user.channelStats,
                    hourlyStats:      user.hourlyStats,
                    dailyStats:       user.dailyStats,
                    attributes:       (user.attributes as Record<string, unknown>) ?? {},
                  });
            lotteryContextVector = context;
            // linucbArms is non-empty (guarded above)
            selectedVariantId = selectVariant({ algorithm: "linucb", linucbArms, context })!;
          } else {
            // Thompson / EpsilonGreedy: blend persona prior with user-specific posterior
            // Fall back to uniform priors (alpha=1, beta=30) for cold-start personas with no arm stats yet
            const personaArms = pageArmsByPersona.get(pid) ?? new Map(
              pageVariants.map((v) => [v.id, { id: v.id, stats: { alpha: 1, beta: 30, tries: 0, wins: 0 } } as BanditArm])
            );
            const userArms = userArmsByUser.get(user.externalId) ?? new Map();

            const arms: BanditArm[] = pageVariants
              .map((v) => {
                const pa = personaArms.get(v.id);
                return pa ? blendArm(pa, userArms.get(v.id)) : undefined;
              })
              .filter(Boolean) as BanditArm[];
            if (arms.length === 0) continue;

            // arms is non-empty (guarded above)
            selectedVariantId = selectVariant(
              agent.algorithm === "epsilon_greedy"
                ? { algorithm: "epsilon_greedy", arms, epsilon: agent.epsilon }
                : { algorithm: "thompson", arms, recencyPenalties },
            )!;
          }

          // Schedule mode: force in_local_time via Braze at the configured hour.
          // Otherwise prefer the user's last-seen hour; fall back to their historical peak hour.
          const effectiveSendHour = scheduleDeliverHour !== null ? null : (user.preferredSendHour ?? peakActivityHour(user.hourlyStats));
          const effectiveSendMinute = scheduleDeliverHour !== null ? null : (user.preferredSendHour !== null ? (user.preferredSendMinute ?? null) : null);
          const { scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
            effectiveSendHour,
            effectiveSendMinute,
            scheduleDeliverHour ?? agent.fallbackSendHour ?? 8,
            now,
          );

          // Global blackout: suppress sends landing on a blackout calendar date (checks the
          // scheduledAt UTC anchor, so rolled-forward fallback sends are caught too).
          if (isBlackoutDate(scheduledAt, blackoutDates)) {
            totalSuppressed++;
            suppress.blackout++;
            continue;
          }

          // Timing window: only select users whose preferred send time is within the next 2 hours.
          // Users on the fallback path (isFallback=true) have no behavioral preference and are
          // always eligible — Braze handles per-user timing via in_local_time scheduling.
          if (!isFallback && scheduledAt.getTime() - now.getTime() > 2 * 60 * 60 * 1000) continue;

          lotteryDecisionInputs.push({
            user,
            variantId: selectedVariantId,
            scheduledAt,
            inLocalTime: isFallback,
            ...(agent.algorithm === "linucb" && lotteryContextVector ? { contextVector: lotteryContextVector } : {}),
          });
        }

        // Bulk-create all UserDecision records in one createManyAndReturn call
        if (lotteryDecisionInputs.length > 0) {
          const decisionData2 = lotteryDecisionInputs.map(({ user, variantId, scheduledAt, inLocalTime, contextVector }) => {
            const pid = user.personaId as string | null;
            const arms = pid ? pageArmsByPersona.get(pid) : null;
            const variantScores: Record<string, number> = {};
            if (arms) {
              for (const [vid, arm] of arms) {
                const a = arm.stats.alpha;
                const b = arm.stats.beta;
                variantScores[vid] = a + b > 0 ? a / (a + b) : 0;
              }
            }
            return {
              agentId:          agent.id,
              userId:           user.externalId,
              messageVariantId: variantId,
              channel:          pageVariants.find((v) => v.id === variantId)?.channel ?? "push",
              scheduledFor:     scheduledAt,
              decisionContext:  {
                ...(pid ? { personaId: pid, selectedVariantId: variantId, variantScores } : {}),
                inLocalTime,
                ...(agent.algorithm === "linucb" && contextVector ? { contextVector } : {}),
              } as unknown as Prisma.InputJsonValue,
            };
          });

          const createdLotteryDecisions = await prisma.userDecision.createManyAndReturn({
            data: decisionData2,
          });

          const lotteryDecisionIdByUser = new Map<string, string>();
          for (let i = 0; i < lotteryDecisionInputs.length; i++) {
            const created = createdLotteryDecisions[i];
            if (created) lotteryDecisionIdByUser.set(lotteryDecisionInputs[i].user.externalId, created.id);
          }

          // Group by variant + scheduled time for batch sending
          byVariant = groupDecisionsByVariant(lotteryDecisionInputs, variantMeta, lotteryDecisionIdByUser);
        }
      }

      // Send all variant groups in parallel batches
      {
        const { sent, errors } = await dispatchSendGroups(
          Object.values(byVariant),
          { brazeClient, factory, agentId: agent.id, prisma },
        );
        totalSent += sent;
        totalErrors += errors;
      }

      if (users.length < 500) break;
    }

    // ── In-window sub-pool for this agent ──────────────────────────────────
    const inWindowUserIdsForAgent = [...inWindowMap.entries()]
      .filter(([, aid]) => aid === agent.id)
      .map(([uid]) => uid);

    if (inWindowUserIdsForAgent.length > 0) {
      // Fetch users and assignments in parallel — independent reads
      const [windowUsers, windowAssignments] = await Promise.all([
        prisma.trackedUser.findMany({
          where: { externalId: { in: inWindowUserIdsForAgent } },
        }),
        prisma.userAgentAssignment.findMany({
          where: { externalUserId: { in: inWindowUserIdsForAgent } },
        }),
      ]);
      const windowAssignmentMap = new Map(
        windowAssignments.map((a) => [a.externalUserId, a])
      );

      // Determine current ET hour and day-of-week for timing check
      const etParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday:  "short",
        hour:     "2-digit",
        hour12:   false,
      }).formatToParts(now);
      const currentHourET = parseInt(
        etParts.find((p) => p.type === "hour")!.value, 10
      );
      const weekdayStr = etParts.find((p) => p.type === "weekday")!.value;
      const dayIndexMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const currentDayET = dayIndexMap[weekdayStr] ?? 0;

      // Frequency cap and global daily cap — run in parallel since they're independent reads
      const windowFreqCap = parseFrequencyCap(rule?.frequencyCap);
      const hasFreqCap = rule && typeof windowFreqCap?.maxSends === "number";
      const periodMs: Record<string, number> = {
        day:    86_400_000,
        week:   7  * 86_400_000,
        biweek: 14 * 86_400_000,
        month:  30 * 86_400_000,
      };
      const freqWindowStart = hasFreqCap
        ? new Date(now.getTime() - (periodMs[windowFreqCap!.period ?? "week"] ?? periodMs.week))
        : null;

      const [recentDecisionsForFreq, sentTodayWindowRows, windowRecentSends] = await Promise.all([
        hasFreqCap
          ? prisma.userDecision.groupBy({
              by: ["userId"],
              where: {
                agentId: agent.id,
                userId:  { in: inWindowUserIdsForAgent },
                sentAt:  { gte: freqWindowStart! },
              },
              _count: { userId: true },
            })
          : Promise.resolve([] as Array<{ userId: string; _count: { userId: number } }>),
        prisma.userDecision.findMany({
          where: {
            userId: { in: inWindowUserIdsForAgent },
            sentAt: { gte: todayStart },
            brazeSendId: { not: null },
          },
          select:   { userId: true },
          distinct: ["userId"],
        }),
        prisma.userDecision.findMany({
          where: {
            agentId:  agent.id,
            userId:   { in: inWindowUserIdsForAgent },
            sentAt:   { gte: new Date(now.getTime() - 7 * 86_400_000) },
            messageVariantId: { not: null },
          },
          select: { userId: true, messageVariantId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
        }),
      ]);

      const windowFreqCappedUserIds = new Set<string>();
      if (hasFreqCap) {
        const countByUser = new Map(recentDecisionsForFreq.map((r) => [r.userId, r._count.userId]));
        for (const u of windowUsers) {
          const count = countByUser.get(u.externalId) ?? 0;
          if (count >= windowFreqCap!.maxSends!) {
            windowFreqCappedUserIds.add(u.externalId);
          }
        }
      }
      const sentTodayWindowIds = new Set(sentTodayWindowRows.map((r) => r.userId));

      // Filter eligible window users by frequency cap + timing check + daily cap
      const eligibleWindowUsers = windowUsers.filter((user) => {
        const assignment = windowAssignmentMap.get(user.externalId);
        if (!assignment || assignment.sendCount >= 4) return false;
        if (windowFreqCappedUserIds.has(user.externalId)) {
          totalSuppressed++;
          return false;
        }
        if (sentTodayWindowIds.has(user.externalId)) {
          totalSuppressed++;
          return false;
        }

        const hourlyStats = (Array.isArray(user.hourlyStats)
          ? user.hourlyStats
          : Array(24).fill(0)) as number[];
        const dailyStats = (Array.isArray(user.dailyStats)
          ? user.dailyStats
          : Array(7).fill(0)) as number[];

        return isTimingMatch(hourlyStats, dailyStats, assignment.sendCount, currentHourET, currentDayET);
      });

      const quietWindowUsers = eligibleWindowUsers;

      // Batch-decide for in-window users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createMany call.
      let windowByVariant: Record<string, VariantSendGroup> = {};
      let sentWindowUserIds: string[] = [];

      if (quietWindowUsers.length > 0) {
        // Collect all unique personaIds among eligible window users
        const windowPersonaIds = [...new Set(
          quietWindowUsers.map((u) => u.personaId).filter(Boolean) as string[]
        )];

        // Load all arm stats for this agent × these personas in one query
        const armStatsRows = await prisma.personaArmStats.findMany({
          where: {
            agentId:   agent.id,
            personaId: { in: windowPersonaIds },
            variantId: { in: allVariantIds },
          },
        });

        // Index arm stats by personaId → variantId → stats
        const armStatsByPersona = new Map<string, Map<string, BanditArm>>();
        for (const row of armStatsRows) {
          if (!armStatsByPersona.has(row.personaId)) {
            armStatsByPersona.set(row.personaId, new Map());
          }
          armStatsByPersona.get(row.personaId)!.set(row.variantId, { id: row.variantId, stats: row });
        }

        // Load per-user arm stats for personalised blending (Thompson/EpsilonGreedy only)
        const windowUserIds = quietWindowUsers.map((u) => u.externalId);
        const windowUserArmRows = agent.algorithm !== "linucb"
          ? await prisma.userArmStats.findMany({
              where: { userId: { in: windowUserIds }, agentId: agent.id, variantId: { in: allVariantIds } },
            })
          : [];
        const windowUserArmsByUser = new Map<string, Map<string, typeof windowUserArmRows[number]>>();
        for (const row of windowUserArmRows) {
          if (!windowUserArmsByUser.has(row.userId)) windowUserArmsByUser.set(row.userId, new Map());
          windowUserArmsByUser.get(row.userId)!.set(row.variantId, row);
        }

        // For LinUCB: load per-agent LinUCB arms once. Reset stale-dimension arms to identity in DB and in-memory.
        const windowLinucbArmsByVariant: Map<string, { id: string; aInv: number[]; b: number[] }> = new Map();
        if (agent.algorithm === "linucb") {
          const freshArm = new LinUCB().initialArm(FEATURE_DIM);
          const allArms = await prisma.linUCBArm.findMany({ where: { agentId: agent.id, variantId: { in: allVariantIds } } });
          const staleArms = allArms.filter(
            (r) =>
              !(Array.isArray(r.aInv) && (r.aInv as number[]).length === FEATURE_DIM * FEATURE_DIM) ||
              !(Array.isArray(r.b) && (r.b as number[]).length === FEATURE_DIM)
          );
          if (staleArms.length > 0) {
            await Promise.all(
              staleArms.map((r) =>
                prisma.linUCBArm.update({
                  where: { agentId_variantId: { agentId: r.agentId, variantId: r.variantId } },
                  data: {
                    aInv: freshArm.aInv as unknown as Prisma.InputJsonValue,
                    b: freshArm.b as unknown as Prisma.InputJsonValue,
                    tries: 0,
                  },
                })
              )
            );
          }
          const staleIds = new Set(staleArms.map((s) => s.variantId));
          for (const r of allArms) {
            const isStale = staleIds.has(r.variantId);
            const aInv = isStale ? freshArm.aInv : (r.aInv as number[]);
            const b = isStale ? freshArm.b : (r.b as number[]);
            windowLinucbArmsByVariant.set(r.variantId, { id: r.variantId, aInv, b });
          }
        }

        // Select variant for each eligible window user (pure in-memory computation)
        const windowVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const decisionInputs: Array<{ user: typeof quietWindowUsers[number]; variantId: string; scheduledAt: Date; inLocalTime: boolean; contextVector?: number[] }> = [];

        for (const user of quietWindowUsers) {
          const pid = user.personaId as string | null;
          if (!pid) continue;

          // Build recency penalty map for this user
          const windowUserRecent = windowRecentSends.filter((r) => r.userId === user.externalId);
          const windowRecencyPenalties: Record<string, number> = {};
          for (const r of windowUserRecent) {
            const vid = r.messageVariantId;
            if (!vid || windowRecencyPenalties[vid] !== undefined) continue;
            const daysSince = (now.getTime() - r.sentAt.getTime()) / 86_400_000;
            windowRecencyPenalties[vid] = recencyMultiplier(daysSince);
          }

          let selectedVariantId: string;
          // Hoisted so decisionContext can include it for LinUCB reward path
          let windowContextVector: number[] | undefined;

          if (agent.algorithm === "linucb") {
            const linucbArms = windowVariants
              .map((v) => windowLinucbArmsByVariant.get(v.id))
              .filter(Boolean) as Array<{ id: string; aInv: number[]; b: number[] }>;
            if (linucbArms.length === 0) continue;
            const storedVec2 = user.featureVector as number[];
            const context: number[] =
              Array.isArray(storedVec2) && storedVec2.length === FEATURE_DIM
                ? storedVec2
                : computeFeatureVector({
                    totalDecisions:   user.totalDecisions,
                    totalConversions: user.totalConversions,
                    totalReward:      user.totalReward,
                    channelStats:     user.channelStats,
                    hourlyStats:      user.hourlyStats,
                    dailyStats:       user.dailyStats,
                    attributes:       (user.attributes as Record<string, unknown>) ?? {},
                  });
            windowContextVector = context;
            // linucbArms is non-empty (guarded above)
            selectedVariantId = selectVariant({ algorithm: "linucb", linucbArms, context })!;
          } else {
            const personaArms = armStatsByPersona.get(pid) ?? new Map(
              windowVariants.map((v) => [v.id, { id: v.id, stats: { alpha: 1, beta: 30, tries: 0, wins: 0 } } as BanditArm])
            );
            const windowUserArms = windowUserArmsByUser.get(user.externalId) ?? new Map();

            const arms: BanditArm[] = windowVariants
              .map((v) => {
                const pa = personaArms.get(v.id);
                return pa ? blendArm(pa, windowUserArms.get(v.id)) : undefined;
              })
              .filter(Boolean) as BanditArm[];
            if (arms.length === 0) continue;

            // arms is non-empty (guarded above)
            selectedVariantId = selectVariant(
              agent.algorithm === "epsilon_greedy"
                ? { algorithm: "epsilon_greedy", arms, epsilon: agent.epsilon }
                : { algorithm: "thompson", arms, recencyPenalties: windowRecencyPenalties },
            )!;
          }

          // Schedule mode: force in_local_time via Braze at the configured hour.
          // Otherwise prefer the user's last-seen hour; fall back to their historical peak hour.
          const effectiveSendHour = scheduleDeliverHour !== null ? null : (user.preferredSendHour ?? peakActivityHour(user.hourlyStats));
          const effectiveSendMinute = scheduleDeliverHour !== null ? null : (user.preferredSendHour !== null ? (user.preferredSendMinute ?? null) : null);
          const { scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
            effectiveSendHour,
            effectiveSendMinute,
            scheduleDeliverHour ?? agent.fallbackSendHour ?? 8,
            now,
          );

          // Global blackout: suppress sends landing on a blackout calendar date (checks the
          // scheduledAt UTC anchor, so rolled-forward fallback sends are caught too).
          if (isBlackoutDate(scheduledAt, blackoutDates)) {
            totalSuppressed++;
            suppress.blackout++;
            continue;
          }

          decisionInputs.push({
            user,
            variantId: selectedVariantId,
            scheduledAt,
            inLocalTime: isFallback,
            ...(agent.algorithm === "linucb" && windowContextVector ? { contextVector: windowContextVector } : {}),
          });
        }

        // Bulk-create all UserDecision records in one createMany call
        const decisionData = decisionInputs.map(({ user, variantId, scheduledAt, inLocalTime, contextVector }) => {
          const pid = user.personaId as string | null;
          const arms = pid ? armStatsByPersona.get(pid) : null;
          const variantScores: Record<string, number> = {};
          if (arms) {
            for (const [vid, arm] of arms) {
              const a = arm.stats.alpha;
              const b = arm.stats.beta;
              variantScores[vid] = a + b > 0 ? a / (a + b) : 0;
            }
          }
          return {
            agentId:          agent.id,
            userId:           user.externalId,
            messageVariantId: variantId,
            channel:          windowVariants.find((v) => v.id === variantId)?.channel ?? "push",
            sentAt:           now,
            scheduledFor:     scheduledAt,
            decisionContext:  {
              ...(pid ? { personaId: pid, selectedVariantId: variantId, variantScores } : {}),
              inLocalTime,
              ...(agent.algorithm === "linucb" && contextVector ? { contextVector } : {}),
            } as unknown as Prisma.InputJsonValue,
          };
        });

        // createMany returns count, not individual IDs — use createManyAndReturn when available,
        // otherwise fall back to individual creates for ID tracking.
        // Prisma 7 supports createManyAndReturn (returns created records with IDs).
        const createdDecisions = await prisma.userDecision.createManyAndReturn({
          data: decisionData,
        });

        // Build a map from externalUserId → decisionId
        const decisionIdByUser = new Map<string, string>();
        for (let i = 0; i < decisionInputs.length; i++) {
          const created = createdDecisions[i];
          if (created) decisionIdByUser.set(decisionInputs[i].user.externalId, created.id);
        }

        // Group by variant + scheduled time for batch sending
        windowByVariant = groupDecisionsByVariant(decisionInputs, variantMeta, decisionIdByUser);
      }

      // Send all window variant groups in parallel batches
      {
        const { sent, errors, sentUserIds } = await dispatchSendGroups(
          Object.values(windowByVariant),
          { brazeClient, factory, agentId: agent.id, prisma },
        );
        totalSent += sent;
        totalErrors += errors;
        sentWindowUserIds = sentUserIds;
      }

      // Increment sendCount for each user who was actually sent to.
      // Use two updateMany calls (increment + conditional complete) instead of N individual updates.
      if (sentWindowUserIds.length > 0) {
        // Collect assignment IDs
        const sentAssignmentIds = sentWindowUserIds
          .map((uid) => windowAssignmentMap.get(uid)?.id)
          .filter(Boolean) as string[];
        // IDs of users whose window completes with this send (sendCount was 3, now becomes 4)
        const completingIds = sentWindowUserIds
          .map((uid) => windowAssignmentMap.get(uid))
          .filter((a) => a && a.sendCount >= 3)
          .map((a) => a!.id);

        await Promise.all([
          // Increment sendCount for all sent users
          prisma.userAgentAssignment.updateMany({
            where: { id: { in: sentAssignmentIds } },
            data: { sendCount: { increment: 1 } },
          }),
          // Mark window complete for users reaching 4 sends
          completingIds.length > 0
            ? prisma.userAgentAssignment.updateMany({
                where: { id: { in: completingIds } },
                data: { windowCompletedAt: now },
              })
            : Promise.resolve(),
        ]);
      }
    }
    // ── End in-window sub-pool ───────────────────────────────────────────────
    agentMetrics.set(agent.id, {
      sent:       totalSent       - metricsBefore.sent,
      suppressed: totalSuppressed - metricsBefore.suppressed,
      errors:     totalErrors     - metricsBefore.errors,
    });
  }

  // Write ModelMetric rows for agents that had any activity
  const metricsToWrite = [...agentMetrics.entries()]
    .filter(([, m]) => m.sent > 0 || m.suppressed > 0 || m.errors > 0)
    .map(([agentId, m]) => ({ agentId, metrics: m }));

  if (metricsToWrite.length > 0) {
    await prisma.modelMetric.createMany({ data: metricsToWrite });
  }

  await prisma.cronRun.update({
    where: { id: cronRunId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      agentCount: agents.length,
      sent: totalSent,
      suppressed: totalSuppressed,
      errors: totalErrors,
    },
  });

  // Invalidate dashboard/performance caches once per cron run when decisions were recorded.
  if (totalSent > 0) {
    revalidateTag("dashboard-stats", "max");
    revalidateTag("performance", "max");
  }

  // Warm the most-visited caches so the first page load after this cron gets a hit.
  // Fire-and-forget: warming failures don't affect the cron response.
  void Promise.all([
    getCachedDashboardCounts(),
    getCachedDashboardTimeSeries(),
    getCachedAgentList(),
    getCachedPerformanceMetrics(),
    getCachedSegments(),
  ]).catch(() => {});

  return NextResponse.json({
    ok: true,
    sent: totalSent,
    suppressed: totalSuppressed,
    errors: totalErrors,
  });
  } finally {
    await prisma.appSetting.delete({ where: { key: "cron_lock_select_and_send" } }).catch(() => {});
    if (cronRunId) {
      await prisma.cronRun.updateMany({
        where: { id: cronRunId, status: "running" },
        data: { status: "failed", finishedAt: new Date() },
      }).catch(() => {});
    }
  }
}

// vercel crons run sends GET; alias to POST so manual triggers work
export async function GET(req: NextRequest) {
  return POST(req);
}
