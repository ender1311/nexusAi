import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
import { buildAgentLottery } from "@/lib/engine/agent-lottery";
import { getTodayStartUTC }  from "@/lib/engine/scheduling";
import { isTimingMatch } from "@/lib/engine/send-timing";
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";
import type { BanditArm } from "@/lib/engine/types";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

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
  decisionIds: string[];
};

/** Returns a Date scheduled at the given UTC hour today, or undefined if already past. */
function computeScheduledAt(preferredHour: number | null, now: Date): Date | undefined {
  if (preferredHour === null) return undefined;
  const candidate = new Date(now);
  candidate.setUTCHours(preferredHour, 0, 0, 0);
  return candidate > now ? candidate : undefined;
}

// Local helper to send a batch of users for a variant group.
// Encapsulates channel switch, payload building, Braze POST, and brazeSendId update.
async function sendVariantGroup(
  group: VariantSendGroup,
  batchUserIds: string[],
  batchDecisionIds: string[],
  brazeClient: ReturnType<typeof createBrazeClient>,
  factory: PayloadFactory,
  prisma: typeof import("@/lib/db").prisma,
  onSuccessfulBatch?: (userIds: string[]) => void,
): Promise<{ sent: number; errors: number }> {
  try {
    const sendId = group.brazeCampaignId
      ? await brazeClient!.createSendId(group.brazeCampaignId)
      : null;

    const audience = { externalUserIds: batchUserIds };
    const sendAt = group.scheduledAt?.toISOString();
    let payload: Record<string, unknown>;

    if (group.channel === "push") {
      payload = factory.buildPushPayload(
        { title: group.title ?? "", body: group.body, deeplink: group.deeplink ?? undefined },
        audience,
        group.brazeCampaignId ?? undefined,
        sendId ?? undefined,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
        sendAt,
      );
    } else if (group.channel === "email") {
      payload = factory.buildEmailPayload(
        { subject: group.title ?? "", htmlBody: group.body },
        audience,
        group.brazeCampaignId ?? undefined,
        sendId ?? undefined,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
        sendAt,
      );
    } else {
      payload = factory.buildSmsPayload(
        { body: group.body },
        audience,
        group.brazeCampaignId ?? undefined,
        sendId ?? undefined,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
        sendAt,
      );
    }

    const res = await brazeClient!.post("/messages/send", payload);
    if (res.ok && sendId) {
      await prisma.userDecision.updateMany({
        where: { id: { in: batchDecisionIds } },
        data: { brazeSendId: sendId },
      });
    }
    if (onSuccessfulBatch) {
      onSuccessfulBatch(batchUserIds);
    }
    return { sent: batchUserIds.length, errors: 0 };
  } catch (err) {
    console.error("[cron/select-and-send] Braze send error:", err);
    return { sent: 0, errors: batchUserIds.length };
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Concurrency lock — prevent duplicate runs if cron invokes before previous run completes
  const lockKey = "cron_lock_select_and_send";
  const existing = await prisma.appSetting.findUnique({ where: { key: lockKey } });
  if (existing) {
    const lockAge = Date.now() - new Date(existing.value).getTime();
    if (lockAge < 290_000) {
      return NextResponse.json({ error: "Already running" }, { status: 409 });
    }
  }
  await prisma.appSetting.upsert({
    where:  { key: lockKey },
    create: { key: lockKey, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  try {

  const brazeClient = createBrazeClient();
  if (!brazeClient) {
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
        const rows = await prisma.trackedUser.findMany({
          where:  { personaId: { in: personaIds } },
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

    // Build eligible agent list per user
    const eligibleAgentsByUser = new Map<string, string[]>();
    for (const user of explorationUsers) {
      if (!user.personaId) continue;
      const eligible: string[] = [];
      for (const agent of explorationAgents) {
        if (agentPersonaSets.get(agent.id)?.has(user.personaId)) {
          eligible.push(agent.id);
        }
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

    // Derive the users assigned to this agent by the lottery
    const assignedUserIds = [...lotteryMap.entries()]
      .filter(([, aid]) => aid === agent.id)
      .map(([uid]) => uid);

    // Exclude in-window users from lottery pipeline (they're handled separately below)
    const lotteryUserIds = assignedUserIds.filter((id) => !inWindowUserIdSet.has(id));

    // Check if this agent has any in-window users to process
    const hasInWindowUsers = [...inWindowMap.entries()].some(([, aid]) => aid === agent.id);

    // If no lottery users and no in-window users, skip agent entirely
    if (lotteryUserIds.length === 0 && !hasInWindowUsers) continue;

    // Build variant detail lookup: variantId → { channel, body, title, deeplink, brazeCampaignId, brazeVariantId, preferredHour }
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      deeplink: string | null;
      brazeCampaignId: string | null;
      brazeVariantId: string | null;
      preferredHour: number | null;
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
          preferredHour:   v.preferredHour ?? null,
        });
      }
    }

    // Evaluate agent-level scheduling checks once (not per user)
    const rule = agent.schedulingRule;

    // When timezone === "user", skip server-side quiet hours check and let Braze
    // deliver in each user's local timezone via in_local_time: true.
    const inLocalTime = (rule?.quietHours as { timezone?: string } | null)?.timezone === "user";

    // 4a. Quiet hours — same for all users, check once (skip when delegating to Braze local time)
    if (rule && !inLocalTime) {
      const quietHours = rule.quietHours as unknown as { start?: string; end?: string; timezone?: string };
      if (quietHours?.start && quietHours?.end) {
        const tzTime = new Intl.DateTimeFormat("en-US", {
          timeZone: quietHours.timezone ?? "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(now);
        const { start, end } = quietHours;
        const inQuiet =
          start > end
            ? tzTime >= start || tzTime < end
            : tzTime >= start && tzTime < end;
        if (inQuiet) {
          // All users for this agent are in quiet hours — skip agent entirely
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

      const [lotteryRecentDecisions, sentTodayRows] = await Promise.all([
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
        // 4d. Global daily cap — cross-agent guard (no agentId filter intentional)
        prisma.userDecision.findMany({
          where: {
            userId: { in: userExternalIds },
            sentAt: { gte: todayStart },
            // intentionally no agentId filter — cross-agent
          },
          select:   { userId: true },
          distinct: ["userId"],
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
        if (
          freqCappedUserIds.has(u.externalId) ||
          smartSuppressedUserIds.has(u.externalId) ||
          sentTodayIds.has(u.externalId)
        ) {
          totalSuppressed++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) =>
          !freqCappedUserIds.has(u.externalId) &&
          !smartSuppressedUserIds.has(u.externalId) &&
          !sentTodayIds.has(u.externalId)
      );

      // Apply targetFilter in-memory on the already-loaded page (V1: no SQL-side JSON filtering)
      const targetFiltered = eligibleUsers.filter((u) => {
        if (!agent.targetFilter) return true;
        return evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
          attributes: u.attributes as Record<string, unknown>,
          computed: buildComputedKeys(u),
        });
      });

      // Batch-decide for lottery users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createManyAndReturn call.
      const byVariant: Record<string, VariantSendGroup> = {};

      if (targetFiltered.length > 0) {
        // Collect unique personaIds among eligible users
        const pagePersonaIds = [...new Set(
          targetFiltered.map((u) => u.personaId).filter(Boolean) as string[]
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

        // Variants with channel for in-memory selection
        const pageVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const lotteryDecisionInputs: Array<{ user: typeof targetFiltered[number]; variantId: string }> = [];
        for (const user of targetFiltered) {
          const pid = user.personaId as string | null;
          if (!pid) continue;
          const personaArms = pageArmsByPersona.get(pid);
          if (!personaArms) continue;

          const arms: BanditArm[] = pageVariants
            .map((v) => personaArms.get(v.id))
            .filter(Boolean) as BanditArm[];
          if (arms.length === 0) continue;

          const selectedVariantId =
            agent.algorithm === "epsilon_greedy"
              ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
              : new ThompsonSampling().select(arms).variantId;

          lotteryDecisionInputs.push({ user, variantId: selectedVariantId });
        }

        // Bulk-create all UserDecision records in one createManyAndReturn call
        if (lotteryDecisionInputs.length > 0) {
          const decisionData2 = lotteryDecisionInputs.map(({ user, variantId }) => ({
            agentId:          agent.id,
            userId:           user.externalId,
            messageVariantId: variantId,
            channel:          pageVariants.find((v) => v.id === variantId)?.channel ?? "push",
          }));

          const createdLotteryDecisions = await prisma.userDecision.createManyAndReturn({
            data: decisionData2,
          });

          const lotteryDecisionIdByUser = new Map<string, string>();
          for (let i = 0; i < lotteryDecisionInputs.length; i++) {
            const created = createdLotteryDecisions[i];
            if (created) lotteryDecisionIdByUser.set(lotteryDecisionInputs[i].user.externalId, created.id);
          }

          // Group by variant + scheduled time for batch sending
          for (const { user, variantId } of lotteryDecisionInputs) {
            const meta = variantMeta.get(variantId);
            if (!meta) continue;
            const decisionId = lotteryDecisionIdByUser.get(user.externalId);
            if (!decisionId) continue;

            const scheduledAt = computeScheduledAt(meta.preferredHour, now);
            const groupKey = `${variantId}:${scheduledAt?.toISOString() ?? 'now'}`;

            if (!byVariant[groupKey]) {
              byVariant[groupKey] = {
                variantId,
                brazeVariantId:  meta.brazeVariantId,
                brazeCampaignId: meta.brazeCampaignId,
                channel:         meta.channel,
                body:            meta.body,
                title:           meta.title,
                deeplink:        meta.deeplink,
                inLocalTime,
                scheduledAt,
                externalUserIds: [],
                decisionIds:     [],
              };
            }
            byVariant[groupKey].externalUserIds.push(user.externalId);
            byVariant[groupKey].decisionIds.push(decisionId);
          }
        }
      }

      // Send each variant group in batches of 50
      for (const group of Object.values(byVariant)) {
        const BATCH = 50;
        for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
          const batchUserIds    = group.externalUserIds.slice(i, i + BATCH);
          const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);

          const result = await sendVariantGroup(
            group,
            batchUserIds,
            batchDecisionIds,
            brazeClient,
            factory,
            prisma,
          );
          totalSent += result.sent;
          totalErrors += result.errors;
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

      const [recentDecisionsForFreq, sentTodayWindowRows] = await Promise.all([
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
          },
          select:   { userId: true },
          distinct: ["userId"],
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

      // Batch-decide for in-window users: load arm stats once, select variant in-memory,
      // then bulk-create all UserDecision records in a single createMany call.
      const windowByVariant: Record<string, VariantSendGroup> = {};
      const sentWindowUserIds: string[] = [];

      if (eligibleWindowUsers.length > 0) {
        // Collect all unique personaIds among eligible window users
        const windowPersonaIds = [...new Set(
          eligibleWindowUsers.map((u) => u.personaId).filter(Boolean) as string[]
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

        // Select variant for each eligible window user (pure in-memory computation)
        const windowVariants = agent.messages.flatMap((m) =>
          m.variants.map((v) => ({ ...v, channel: m.channel }))
        );

        const decisionInputs: Array<{ user: typeof eligibleWindowUsers[number]; variantId: string }> = [];

        for (const user of eligibleWindowUsers) {
          const pid = user.personaId as string | null;
          if (!pid) continue;
          const personaArms = armStatsByPersona.get(pid);
          if (!personaArms) continue;

          const arms: BanditArm[] = windowVariants
            .map((v) => personaArms.get(v.id))
            .filter(Boolean) as BanditArm[];
          if (arms.length === 0) continue;

          const selectedVariantId =
            agent.algorithm === "epsilon_greedy"
              ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
              : new ThompsonSampling().select(arms).variantId;

          decisionInputs.push({ user, variantId: selectedVariantId });
        }

        // Bulk-create all UserDecision records in one createMany call
        const now2 = new Date();
        const decisionData = decisionInputs.map(({ user, variantId }) => ({
          agentId:          agent.id,
          userId:           user.externalId,
          messageVariantId: variantId,
          channel:          windowVariants.find((v) => v.id === variantId)?.channel ?? "push",
          sentAt:           now2,
        }));

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
        for (const { user, variantId } of decisionInputs) {
          const meta = variantMeta.get(variantId);
          if (!meta) continue;
          const decisionId = decisionIdByUser.get(user.externalId);
          if (!decisionId) continue;

          const scheduledAt = computeScheduledAt(meta.preferredHour, now);
          const groupKey = `${variantId}:${scheduledAt?.toISOString() ?? 'now'}`;

          if (!windowByVariant[groupKey]) {
            windowByVariant[groupKey] = {
              variantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              deeplink:        meta.deeplink,
              inLocalTime,
              scheduledAt,
              externalUserIds: [],
              decisionIds:     [],
            };
          }
          windowByVariant[groupKey].externalUserIds.push(user.externalId);
          windowByVariant[groupKey].decisionIds.push(decisionId);
        }
      }

      // Send each window variant group in batches of 50 (same as normal pipeline)
      for (const group of Object.values(windowByVariant)) {
        const BATCH = 50;
        for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
          const batchUserIds     = group.externalUserIds.slice(i, i + BATCH);
          const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);

          // Only mark users as sent after a successful Braze call so that
          // sendCount is not incremented when the send fails.
          const result = await sendVariantGroup(
            group,
            batchUserIds,
            batchDecisionIds,
            brazeClient,
            factory,
            prisma,
            (userIds) => sentWindowUserIds.push(...userIds),
          );
          totalSent += result.sent;
          totalErrors += result.errors;
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

  return NextResponse.json({ ok: true, sent: totalSent, suppressed: totalSuppressed, errors: totalErrors });
  } finally {
    await prisma.appSetting.delete({ where: { key: "cron_lock_select_and_send" } }).catch(() => {});
  }
}
