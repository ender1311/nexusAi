import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
import { buildAgentLottery } from "@/lib/engine/agent-lottery";
import { getTodayStartUTC, computeScheduledAt, peakActivityHour, isInQuietHours }  from "@/lib/engine/scheduling";
import { isTimingMatch } from "@/lib/engine/send-timing";
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";
import { LinUCB } from "@/lib/engine/linucb";
import { computeFeatureVector } from "@/lib/engine/feature-vector";
import type { BanditArm } from "@/lib/engine/types";
import { recencyMultiplier } from "@/lib/engine/beta-pdf";
import type { BrazeRecipient } from "@/lib/braze/payload-factory";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

/**
 * Blend persona-level prior with per-user observations to form a personalised arm.
 * The persona's Beta distribution is the prior; user-specific wins/tries shift it.
 * This is a standard Bayesian posterior update: more user data → more personalised.
 */
function blendArm(
  personaArm: BanditArm,
  userStats: { alpha: number; beta: number; tries: number; wins: number } | undefined,
): BanditArm {
  if (!userStats || userStats.tries === 0) return personaArm;
  return {
    id: personaArm.id,
    stats: {
      alpha: personaArm.stats.alpha + userStats.wins,
      beta:  personaArm.stats.beta  + (userStats.tries - userStats.wins),
      tries: personaArm.stats.tries + userStats.tries,
      wins:  personaArm.stats.wins  + userStats.wins,
    },
  };
}

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback for cron
  return token === secret;
}

type VariantSendGroup = {
  variantId: string;
  brazeVariantId: string | null;
  brazeCampaignId: string | null;
  channel: string;
  body: string;
  title: string | null;
  deeplink: string | null;
  inLocalTime?: boolean;
  scheduledAt?: Date;
  externalUserIds: string[];
  /** Nexus externalIds that are actually Braze user IDs (unverified users).
   *  These are sent via the recipients[] format with braze_id instead of external_user_id. */
  brazeOnlyIds: Set<string>;
  decisionIds: string[];
};

// Local helper to send a batch of users for a variant group.
// Encapsulates channel switch, payload building, Braze POST, and brazeSendId update.
async function sendVariantGroup(
  group: VariantSendGroup,
  batchUserIds: string[],
  batchDecisionIds: string[],
  brazeClient: ReturnType<typeof createBrazeClient>,
  factory: PayloadFactory,
  agentId: string,
  prisma: typeof import("@/lib/db").prisma,
  onSuccessfulBatch?: (userIds: string[]) => void,
): Promise<{ sent: number; errors: number }> {
  try {
    // BRAZE_NEXUS_CAMPAIGN_ID is the authoritative single Nexus campaign.
    // It takes precedence over per-message DB values so all sends flow through
    // one campaign and can be tracked in aggregate in Braze.
    const resolvedCampaignId =
      process.env.BRAZE_NEXUS_CAMPAIGN_ID ??
      group.brazeCampaignId ??
      undefined;

    // Use recipients[] format when the batch contains unverified users (braze_id only).
    // Verified users get { external_user_id }; unverified users get { braze_id }.
    const hasBrazeOnly = batchUserIds.some((id) => group.brazeOnlyIds.has(id));
    const audience = hasBrazeOnly
      ? { recipients: batchUserIds.map((id): BrazeRecipient =>
          group.brazeOnlyIds.has(id) ? { braze_id: id } : { external_user_id: id }
        )}
      : { externalUserIds: batchUserIds };
    let payload: Record<string, unknown>;

    if (group.channel === "push") {
      payload = factory.buildPushPayload(
        { title: group.title ?? "", body: group.body, deeplink: group.deeplink ?? undefined },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
    } else if (group.channel === "email") {
      payload = factory.buildEmailPayload(
        { subject: group.title ?? "", htmlBody: group.body },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
    } else {
      payload = factory.buildSmsPayload(
        { body: group.body },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
    }

    // Route to scheduled endpoint when group has a future send time
    const endpoint = group.scheduledAt
      ? "/messages/schedule/create"
      : "/messages/send";

    if (group.scheduledAt) {
      payload = { ...payload, schedule: { time: group.scheduledAt.toISOString() } };
    }

    // Do NOT pass send_id to Braze — Braze Currents events carry Braze's auto-assigned
    // send_id back to us via /api/ingest/braze-events. We store a local UUID on
    // UserDecision only as an "accepted by Braze" marker for the daily cap check.
    const sendId = randomUUID();

    const res = await brazeClient!.post(endpoint, payload);
    if (res.ok) {
      // Parse schedule_id for scheduled sends (returned by /messages/schedule/create)
      let brazeScheduleId: string | null = null;
      if (group.scheduledAt) {
        try {
          const json = await res.json() as { schedule_id?: string };
          brazeScheduleId = json.schedule_id ?? null;
        } catch { /* ignore parse errors */ }
      }
      // Persist tracking IDs on decisions so the analytics cron can match them
      await prisma.userDecision.updateMany({
        where: { id: { in: batchDecisionIds } },
        data: {
          brazeSendId: sendId,
          ...(brazeScheduleId && { brazeScheduleId }),
        },
      });
      if (onSuccessfulBatch) {
        onSuccessfulBatch(batchUserIds);
      }
      return { sent: batchUserIds.length, errors: 0 };
    } else {
      // HTTP-level Braze error (non-exception path) — record failure, don't count as sent
      let responseBody: unknown;
      try { responseBody = await res.json(); } catch { responseBody = null; }
      const reason = `HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
      console.error("[cron/select-and-send] Braze HTTP error:", reason, { variantId: group.variantId });
      void prisma.failedBrazeSend.create({
        data: {
          agentId,
          variantId: group.variantId,
          channel:    group.channel,
          userIds:    batchUserIds,
          decisionIds: batchDecisionIds,
          reason,
        },
      }).catch((dbErr: unknown) => {
        console.error("[cron/select-and-send] Failed to write FailedBrazeSend record:", dbErr);
      });
      return { sent: 0, errors: batchUserIds.length };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[cron/select-and-send] Braze send error:", err);
    void prisma.failedBrazeSend.create({
      data: {
        agentId,
        variantId: group.variantId,
        channel:   group.channel,
        userIds:   batchUserIds,
        decisionIds: batchDecisionIds,
        reason,
      },
    }).catch((dbErr: unknown) => {
      console.error("[cron/select-and-send] Failed to write FailedBrazeSend record:", dbErr);
    });
    return { sent: 0, errors: batchUserIds.length };
  }
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
        const rows = await prisma.trackedUser.findMany({
          where:  { personaId: { in: personaIds }, ...langFilter, ...funnelFilter },
          select: { externalId: true },
        });
        eligibleUsersByAgent.set(agent.id, rows.map((r) => r.externalId));
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

    // For each exploration agent, index the personas it targets
    const agentPersonaSets = new Map<string, Set<string>>();
    for (const agent of explorationAgents) {
      agentPersonaSets.set(
        agent.id,
        new Set(agent.personaTargets.map((pt) => pt.personaId))
      );
    }

    // Build eligible agent list per user (respects per-agent language filter)
    const eligibleAgentsByUser = new Map<string, string[]>();
    for (const user of explorationUsers) {
      if (!user.personaId) continue;
      const eligible: string[] = [];
      for (const agent of explorationAgents) {
        if (!agentPersonaSets.get(agent.id)?.has(user.personaId)) continue;
        const attrs = user.attributes as Record<string, unknown>;
        // Push-enabled filter: exclude users who have explicitly set push_enabled: false.
        // Users without the attribute are treated as opted-in (opt-out model).
        const agentHasPush = agent.messages.some((m) => m.channel === "push");
        if (agentHasPush && attrs?.push_enabled === false) continue;
        // Language filter: agent.languageFilter takes precedence;
        // push agents without explicit filter default to English-only sends.
        const effectiveLang =
          (agent.languageFilter && agent.languageFilter !== "all")
            ? agent.languageFilter
            : agentHasPush
              ? "en"
              : null;
        if (effectiveLang) {
          const lang = attrs?.language_tag as string | undefined;
          if (!lang?.startsWith(effectiveLang)) continue;
        }
        // Funnel stage filter: skip user if their funnelStage doesn't match the agent's
        if (agent.funnelStage && user.funnelStage !== agent.funnelStage) continue;
        eligible.push(agent.id);
      }
      if (eligible.length > 0) eligibleAgentsByUser.set(user.externalId, eligible);
    }

    // Class A: new assignments (no prior record) — bulk create in one round trip
    const toCreate: Array<{ externalUserId: string; agentId: string }> = [];
    // Class D: reset existing assignments (cooldown expired) — upsert per row (different agentId per user)
    const toReset:  Array<{ externalUserId: string; agentId: string }> = [];
    const toClose:  string[] = []; // assignment IDs where window expired without 4 sends

    for (const user of explorationUsers) {
      const assignment = assignmentByUser.get(user.externalId);

      if (!assignment) {
        // Class A: no prior assignment — newly eligible
        const eligible = eligibleAgentsByUser.get(user.externalId) ?? [];
        if (eligible.length === 0) continue;
        const agentId = eligible[Math.floor(Math.random() * eligible.length)];
        toCreate.push({ externalUserId: user.externalId, agentId });
        inWindowMap.set(user.externalId, agentId);
      } else if (assignment.windowCompletedAt === null) {
        const age = now.getTime() - assignment.startedAt.getTime();
        if (age <= windowMs) {
          // Class B: active window — keep locked
          inWindowMap.set(user.externalId, assignment.agentId);
        } else {
          // Class C: 8 days elapsed, never hit 4 sends — close window
          toClose.push(assignment.id);
        }
      } else {
        const timeSinceComplete = now.getTime() - assignment.windowCompletedAt.getTime();
        if (timeSinceComplete > cooldownMs) {
          // Class D: cooldown expired — new window
          const eligible = eligibleAgentsByUser.get(user.externalId) ?? [];
          if (eligible.length === 0) continue;
          const agentId = eligible[Math.floor(Math.random() * eligible.length)];
          toReset.push({ externalUserId: user.externalId, agentId });
          inWindowMap.set(user.externalId, agentId);
        }
        // Class E: cooldown not yet expired — no action
      }
    }

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
    const suppress = { freqCap: 0, smartSuppress: 0, dailyCap: 0, targetFilter: 0, audienceCap: 0 };

    // Derive the users assigned to this agent by the lottery
    const assignedUserIds = [...lotteryMap.entries()]
      .filter(([, aid]) => aid === agent.id)
      .map(([uid]) => uid);

    // Exclude in-window users from lottery pipeline (they're handled separately below)
    let lotteryUserIds = assignedUserIds.filter((id) => !inWindowUserIdSet.has(id));

    // Apply audience cap — shuffle and truncate if set
    if (agent.audienceCap !== null && agent.audienceCap !== undefined) {
      for (let i = lotteryUserIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lotteryUserIds[i], lotteryUserIds[j]] = [lotteryUserIds[j], lotteryUserIds[i]];
      }
      const preCap = lotteryUserIds.length;
      lotteryUserIds = lotteryUserIds.slice(0, agent.audienceCap);
      suppress.audienceCap = preCap - lotteryUserIds.length;
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

    const quietHoursConfig = rule?.quietHours as { start?: string; end?: string; timezone?: string } | null;
    // When timezone === "user", skip the agent-level check; enforce per-user below.
    const inLocalTime = quietHoursConfig?.timezone === "user";

    // 4a. Quiet hours — agent-level check (single timezone, checked once per agent per run)
    if (rule && !inLocalTime) {
      if (quietHoursConfig?.start && quietHoursConfig?.end) {
        if (isInQuietHours(quietHoursConfig.timezone ?? "UTC", quietHoursConfig.start, quietHoursConfig.end, now)) {
          console.log("[cron/select-and-send] agent suppressed — quiet hours", {
            agentId: agent.id, agentName: agent.name, timezone: quietHoursConfig.timezone ?? "UTC",
          });
          continue;
        }
      }
    }

    // Pre-seed PersonaArmStats for all persona × variant combinations so
    // concurrent decideForUser calls don't race on the upsert — run in parallel.
    const allVariantIds = agent.messages.flatMap((m) => m.variants.map((v) => v.id));
    const initialAlpha = agent.algorithm === "thompson" ? 1 : 0;
    const initialBeta  = agent.algorithm === "thompson" ? 30 : 0;
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
      const freqCap = rule?.frequencyCap as unknown as { maxSends?: number; period?: string } | null;
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

      // Count suppressed users (freq cap + smart suppress + global daily cap)
      for (const u of users) {
        const isFreqCapped  = freqCappedUserIds.has(u.externalId);
        const isSmartSup    = smartSuppressedUserIds.has(u.externalId);
        const isDailyCapped = sentTodayIds.has(u.externalId);
        if (isFreqCapped || isSmartSup || isDailyCapped) {
          totalSuppressed++;
          if (isFreqCapped)  suppress.freqCap++;
          if (isSmartSup)    suppress.smartSuppress++;
          if (isDailyCapped) suppress.dailyCap++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) =>
          !freqCappedUserIds.has(u.externalId) &&
          !smartSuppressedUserIds.has(u.externalId) &&
          !sentTodayIds.has(u.externalId)
      );

      // Push-enabled filter: exclude users who have explicitly set push_enabled: false.
      // Users without the attribute are treated as opted-in (opt-out model).
      // Checked in-memory for reliability (JSONB boolean comparison via Prisma path filter is fragile).
      const hasPushMessages = agent.messages.some((m) => m.channel === "push");
      const pushFiltered = hasPushMessages
        ? eligibleUsers.filter((u) => {
            const attrs = u.attributes as Record<string, unknown>;
            return attrs?.push_enabled !== false;
          })
        : eligibleUsers;
      suppress.targetFilter += eligibleUsers.length - pushFiltered.length;

      // Language filter for push agents: English-only sends by default.
      // Checked in-memory for reliability (JSONB path filter is fragile with Neon HTTP adapter).
      const effectiveAgentLang =
        agent.languageFilter && agent.languageFilter !== "all"
          ? agent.languageFilter
          : hasPushMessages ? "en" : null;
      const langFiltered = effectiveAgentLang
        ? pushFiltered.filter((u) => {
            const attrs = u.attributes as Record<string, unknown>;
            const lang = attrs?.language_tag as string | undefined;
            return lang?.startsWith(effectiveAgentLang) === true;
          })
        : pushFiltered;
      suppress.targetFilter += pushFiltered.length - langFiltered.length;

      // Apply targetFilter in-memory on the already-loaded page (V1: no SQL-side JSON filtering)
      const targetFiltered = langFiltered.filter((u) => {
        if (!agent.targetFilter) return true;
        return evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
          attributes: u.attributes as Record<string, unknown>,
          computed: buildComputedKeys(u),
        });
      });
      suppress.targetFilter += langFiltered.length - targetFiltered.length;

      // Per-user quiet hours: when timezone === "user", suppress users whose stored
      // IANA timezone is currently inside the configured quiet window.
      // Users with no timezone stored are passed through (can't enforce, don't suppress).
      const quietFiltered = (inLocalTime && quietHoursConfig?.start && quietHoursConfig?.end)
        ? targetFiltered.filter((u) => {
            if (!u.timezone) return true;
            return !isInQuietHours(u.timezone, quietHoursConfig!.start!, quietHoursConfig!.end!, now);
          })
        : targetFiltered;
      suppress.targetFilter += targetFiltered.length - quietFiltered.length;

      // Batch-decide for lottery users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createManyAndReturn call.
      const byVariant: Record<string, VariantSendGroup> = {};

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

        // For LinUCB: load per-agent LinUCB arms once (keyed by variantId)
        const linucbArmsByVariant = agent.algorithm === "linucb"
          ? new Map(
              (await prisma.linUCBArm.findMany({ where: { agentId: agent.id, variantId: { in: allVariantIds } } }))
                .map((r) => [r.variantId, { id: r.variantId, aInv: r.aInv as number[], b: r.b as number[] }])
            )
          : new Map<string, { id: string; aInv: number[]; b: number[] }>();

        // Variants with channel for in-memory selection
        const pageVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const lotteryDecisionInputs: Array<{ user: typeof quietFiltered[number]; variantId: string; scheduledAt: Date; inLocalTime: boolean }> = [];
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

          if (agent.algorithm === "linucb") {
            // LinUCB: select variant from the user's feature context
            const linucbArms = pageVariants
              .map((v) => linucbArmsByVariant.get(v.id))
              .filter(Boolean) as Array<{ id: string; aInv: number[]; b: number[] }>;
            if (linucbArms.length === 0) continue;

            // Use stored feature vector or compute on the fly from user behavioral stats
            const context: number[] = Array.isArray(user.featureVector)
              ? (user.featureVector as number[])
              : computeFeatureVector({
                  totalDecisions:   user.totalDecisions,
                  totalConversions: user.totalConversions,
                  totalReward:      user.totalReward,
                  channelStats:     user.channelStats,
                  hourlyStats:      user.hourlyStats,
                  dailyStats:       user.dailyStats,
                  attributes:       (user.attributes as Record<string, unknown>) ?? {},
                });
            selectedVariantId = new LinUCB().select(linucbArms, context).variantId;
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

            selectedVariantId =
              agent.algorithm === "epsilon_greedy"
                ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
                : new ThompsonSampling().select(arms, recencyPenalties).variantId;
          }

          // Prefer the user's last-seen hour; fall back to their historical peak engagement hour
          // before resorting to the agent-wide fallbackSendHour (which is the same for all users).
          const effectiveSendHour = user.preferredSendHour ?? peakActivityHour(user.hourlyStats);
          const effectiveSendMinute = user.preferredSendHour !== null ? (user.preferredSendMinute ?? null) : null;
          const { scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
            effectiveSendHour,
            effectiveSendMinute,
            agent.fallbackSendHour ?? 8,
            now,
          );

          lotteryDecisionInputs.push({ user, variantId: selectedVariantId, scheduledAt, inLocalTime: isFallback });
        }

        // Bulk-create all UserDecision records in one createManyAndReturn call
        if (lotteryDecisionInputs.length > 0) {
          const decisionData2 = lotteryDecisionInputs.map(({ user, variantId, scheduledAt }) => {
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
              decisionContext:  pid ? { personaId: pid, selectedVariantId: variantId, variantScores } : undefined,
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
          for (const { user, variantId, scheduledAt, inLocalTime: isFallback } of lotteryDecisionInputs) {
            const meta = variantMeta.get(variantId);
            if (!meta) continue;
            const decisionId = lotteryDecisionIdByUser.get(user.externalId);
            if (!decisionId) continue;

            const groupInLocalTime = isFallback;
            const groupKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}`;

            if (!byVariant[groupKey]) {
              byVariant[groupKey] = {
                variantId,
                brazeVariantId:  meta.brazeVariantId,
                brazeCampaignId: meta.brazeCampaignId,
                channel:         meta.channel,
                body:            meta.body,
                title:           meta.title,
                deeplink:        meta.deeplink,
                inLocalTime:     groupInLocalTime,
                scheduledAt,
                externalUserIds: [],
                brazeOnlyIds:    new Set(),
                decisionIds:     [],
              };
            }
            byVariant[groupKey].externalUserIds.push(user.externalId);
            // Unverified users have externalId === brazeId — flag them for braze_id targeting
            if (user.brazeId && user.externalId === user.brazeId) {
              byVariant[groupKey].brazeOnlyIds.add(user.externalId);
            }
            byVariant[groupKey].decisionIds.push(decisionId);
          }
        }
      }

      // Send all variant groups in parallel batches of 50
      {
        const BATCH = 50;
        const CONCURRENCY = 50;
        const sendTasks: Array<() => Promise<{ sent: number; errors: number }>> = [];
        for (const group of Object.values(byVariant)) {
          for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
            const batchUserIds    = group.externalUserIds.slice(i, i + BATCH);
            const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);
            sendTasks.push(
              () => sendVariantGroup(group, batchUserIds, batchDecisionIds, brazeClient, factory, agent.id, prisma),
            );
          }
        }

        for (let i = 0; i < sendTasks.length; i += CONCURRENCY) {
          const results = await Promise.allSettled(sendTasks.slice(i, i + CONCURRENCY).map((t) => t()));
          for (const r of results) {
            if (r.status === "fulfilled") {
              totalSent += r.value.sent;
              totalErrors += r.value.errors;
            } else {
              totalErrors++;
            }
          }
        }
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
      const windowFreqCap = rule?.frequencyCap as unknown as { maxSends?: number; period?: string } | null;
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

      // Per-user quiet hours for window path (same logic as lottery path above)
      const quietWindowUsers = (inLocalTime && quietHoursConfig?.start && quietHoursConfig?.end)
        ? eligibleWindowUsers.filter((u) => {
            if (!u.timezone) return true;
            return !isInQuietHours(u.timezone, quietHoursConfig!.start!, quietHoursConfig!.end!, now);
          })
        : eligibleWindowUsers;

      // Batch-decide for in-window users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createMany call.
      const windowByVariant: Record<string, VariantSendGroup> = {};
      const sentWindowUserIds: string[] = [];

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

        // For LinUCB: load per-agent LinUCB arms once
        const windowLinucbArmsByVariant = agent.algorithm === "linucb"
          ? new Map(
              (await prisma.linUCBArm.findMany({ where: { agentId: agent.id, variantId: { in: allVariantIds } } }))
                .map((r) => [r.variantId, { id: r.variantId, aInv: r.aInv as number[], b: r.b as number[] }])
            )
          : new Map<string, { id: string; aInv: number[]; b: number[] }>();

        // Select variant for each eligible window user (pure in-memory computation)
        const windowVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const decisionInputs: Array<{ user: typeof quietWindowUsers[number]; variantId: string; scheduledAt: Date; inLocalTime: boolean }> = [];

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

          if (agent.algorithm === "linucb") {
            const linucbArms = windowVariants
              .map((v) => windowLinucbArmsByVariant.get(v.id))
              .filter(Boolean) as Array<{ id: string; aInv: number[]; b: number[] }>;
            if (linucbArms.length === 0) continue;
            const context: number[] = Array.isArray(user.featureVector)
              ? (user.featureVector as number[])
              : computeFeatureVector({
                  totalDecisions:   user.totalDecisions,
                  totalConversions: user.totalConversions,
                  totalReward:      user.totalReward,
                  channelStats:     user.channelStats,
                  hourlyStats:      user.hourlyStats,
                  dailyStats:       user.dailyStats,
                  attributes:       (user.attributes as Record<string, unknown>) ?? {},
                });
            selectedVariantId = new LinUCB().select(linucbArms, context).variantId;
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

            selectedVariantId =
              agent.algorithm === "epsilon_greedy"
                ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
                : new ThompsonSampling().select(arms, windowRecencyPenalties).variantId;
          }

          // Prefer the user's last-seen hour; fall back to their historical peak engagement hour
          // before resorting to the agent-wide fallbackSendHour (which is the same for all users).
          const effectiveSendHour = user.preferredSendHour ?? peakActivityHour(user.hourlyStats);
          const effectiveSendMinute = user.preferredSendHour !== null ? (user.preferredSendMinute ?? null) : null;
          const { scheduledAt, inLocalTime: isFallback } = computeScheduledAt(
            effectiveSendHour,
            effectiveSendMinute,
            agent.fallbackSendHour ?? 8,
            now,
          );

          decisionInputs.push({ user, variantId: selectedVariantId, scheduledAt, inLocalTime: isFallback });
        }

        // Bulk-create all UserDecision records in one createMany call
        const decisionData = decisionInputs.map(({ user, variantId, scheduledAt }) => {
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
            decisionContext:  pid ? { personaId: pid, selectedVariantId: variantId, variantScores } : undefined,
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
        for (const { user, variantId, scheduledAt, inLocalTime: isFallback } of decisionInputs) {
          const meta = variantMeta.get(variantId);
          if (!meta) continue;
          const decisionId = decisionIdByUser.get(user.externalId);
          if (!decisionId) continue;

          const groupInLocalTime = isFallback;
          const groupKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}`;

          if (!windowByVariant[groupKey]) {
            windowByVariant[groupKey] = {
              variantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              deeplink:        meta.deeplink,
              inLocalTime:     groupInLocalTime,
              scheduledAt,
              externalUserIds: [],
              brazeOnlyIds:    new Set(),
              decisionIds:     [],
            };
          }
          windowByVariant[groupKey].externalUserIds.push(user.externalId);
          if (user.brazeId && user.externalId === user.brazeId) {
            windowByVariant[groupKey].brazeOnlyIds.add(user.externalId);
          }
          windowByVariant[groupKey].decisionIds.push(decisionId);
        }
      }

      // Send all window variant groups in parallel batches of 50
      {
        const BATCH = 50;
        const CONCURRENCY = 50;
        type WindowSendTask = () => Promise<{ sent: number; errors: number; userIds: string[] }>;
        const windowSendTasks: WindowSendTask[] = [];
        for (const group of Object.values(windowByVariant)) {
          for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
            const batchUserIds     = group.externalUserIds.slice(i, i + BATCH);
            const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);
            windowSendTasks.push(async () => {
              const localSent: string[] = [];
              const result = await sendVariantGroup(
                group, batchUserIds, batchDecisionIds, brazeClient, factory, agent.id, prisma,
                (userIds) => localSent.push(...userIds),
              );
              return { ...result, userIds: localSent };
            });
          }
        }

        for (let i = 0; i < windowSendTasks.length; i += CONCURRENCY) {
          const results = await Promise.allSettled(windowSendTasks.slice(i, i + CONCURRENCY).map((t) => t()));
          for (const r of results) {
            if (r.status === "fulfilled") {
              totalSent += r.value.sent;
              totalErrors += r.value.errors;
              sentWindowUserIds.push(...r.value.userIds);
            } else {
              totalErrors++;
            }
          }
        }
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
    console.log("[cron/select-and-send] agent summary", {
      agentId:   agent.id,
      agentName: agent.name,
      sent:       totalSent       - metricsBefore.sent,
      suppressed: totalSuppressed - metricsBefore.suppressed,
      errors:     totalErrors     - metricsBefore.errors,
      suppressBreakdown: suppress,
    });
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
