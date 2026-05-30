import { LinUCB } from "@/lib/engine/linucb";
import { selectVariant } from "@/lib/engine/select-variant";
import { assignUserToPersona } from "@/lib/services/persona-service";
import { computeFeatureVector } from "@/lib/engine/feature-vector";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
import { isInQuietHours, isQuietDay, peakActivityHour } from "@/lib/engine/scheduling";
import { parseQuietHours, parseFrequencyCap } from "@/lib/schemas/scheduling";
import { prisma } from "@/lib/db";
import type { BanditArm } from "@/lib/engine/types";
import type { Prisma } from "@/generated/prisma/client";

// The shape of agent as fetched by decideForUser — with messages+variants and schedulingRule
type AgentWithVariants = Prisma.AgentGetPayload<{
  include: {
    messages: { include: { variants: { where: { status: string } } } };
    schedulingRule: true;
  };
}>;

/** Caller-supplied context at decide-time (optional; enriches decisions and training data). */
export type DecideContext = {
  /** YouVersion giving tier, e.g. "sower", "giver", "" */
  giver_tier?: string;
  /** Whether the user is at risk of losing a streak, actively streaking, or broke their streak */
  streak_status?: "at_risk" | "active" | "broken";
  /** Days into current streak (plan_day_current_month_count) */
  streak_days?: number;
  /** Days since last app open */
  recency_days?: number;
  /** Trigger event that caused this decision (e.g. "streak_break", "giving_prompt") */
  trigger_event?: string;
};

export type DecideInput = {
  agentId: string;
  externalUserId: string;
  /** Optional: pre-fetched agent data. When provided, skips the DB fetch for the agent. */
  preloadedAgent?: AgentWithVariants;
  /**
   * Optional: set to true to skip scheduling rule checks (quiet hours, frequency cap,
   * smart suppression). Used by the cron route which performs bulk scheduling checks
   * before calling decideForUser, eliminating per-user DB queries for those checks.
   */
  skipSchedulingChecks?: boolean;
  /** Optional: context about the user at decision time — stored on UserDecision for analysis
   *  and used as feature input when algorithm is "linucb". */
  context?: DecideContext;
};

export type DecideResult =
  | { suppressed: true; reason: "quiet_hours" | "frequency_cap" | "smart_suppression" }
  | {
      suppressed: false;
      brazeVariantId: string | null;
      deeplink: string | null;
      messageVariantId: string;
      channel: string;
      userDecisionId: string;
      /** Best send hour (0-23) derived from user's hourlyStats app-usage curve; null if no data */
      recommendedSendHour: number | null;
    };

/**
 * Core bandit decision function. Shared by /api/decide and /api/cron/select-and-send.
 *
 * Returns null when the agent doesn't exist, is inactive, or has no active variants.
 * Returns DecideResult otherwise (may be suppressed if scheduling rules block the send).
 */
export async function decideForUser(input: DecideInput): Promise<DecideResult | null> {
  const { agentId, externalUserId, preloadedAgent, skipSchedulingChecks, context } = input;

  // 1. Fetch agent with all active variants and scheduling rule (skip if preloaded)
  const agent = preloadedAgent ?? await prisma.agent.findFirst({
    where: { id: agentId, status: "active" },
    include: {
      messages: {
        include: {
          variants: { where: { status: "active" } },
        },
      },
      schedulingRule: true,
    },
  });
  if (!agent) return null;

  // Flatten variants, carrying channel from their parent message
  const variants = agent.messages.flatMap((m) =>
    m.variants.map((v) => ({ ...v, channel: m.channel }))
  );
  if (variants.length === 0) return null;

  // 2. Fetch or create user. Use upsert with a P2002 fallback to handle concurrent
  // callers: if two requests race on the same new externalUserId, the losing caller
  // catches the unique constraint violation and reads the row the winner created.
  // The Neon driver adapter implements upsert as SELECT + INSERT (not native ON CONFLICT),
  // so P2002 is possible under true concurrency even with upsert.
  const user = await prisma.trackedUser
    .upsert({
      where: { externalId: externalUserId },
      create: { externalId: externalUserId },
      update: {},
    })
    .catch(async (err: { code?: string }) => {
      if (err?.code === "P2002") {
        // Concurrent insert race: another caller won — read the row they created
        return prisma.trackedUser.findUniqueOrThrow({
          where: { externalId: externalUserId },
        });
      }
      throw err;
    });

  // 3. Resolve personaId — try cached, then assignment, then fallback to largest persona
  let personaId: string | null = user.personaId ?? null;
  if (!personaId) {
    const assigned = await assignUserToPersona(externalUserId);
    personaId = assigned.personaId;
  }
  if (!personaId) {
    const fallback = await prisma.persona.findFirst({
      where: { isActive: true },
      orderBy: { clusterSize: "desc" },
    });
    personaId = fallback?.id ?? null;
  }
  if (!personaId) return null; // no personas configured

  // 3b. targetFilter check — bail before variant selection
  if (agent.targetFilter) {
    const computed = buildComputedKeys(user);
    const passes = evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
      attributes: user.attributes as Record<string, unknown>,
      computed,
    });
    if (!passes) return null;
  }

  // 4. Scheduling rule checks (skipped when caller has already performed them)
  const rule = agent.schedulingRule;
  const now = new Date();

  if (rule && !skipSchedulingChecks) {
    // 4a. Quiet hours — suppress mode only; none/schedule skip the server-side check.
    // Backward compat: legacy records without mode default to suppress (or schedule if timezone="user").
    const quietHoursRaw = parseQuietHours(rule.quietHours);
    const qhMode = quietHoursRaw?.mode ?? (quietHoursRaw?.timezone === "user" ? "schedule" : quietHoursRaw ? "suppress" : "none");
    if (qhMode === "suppress" && quietHoursRaw?.start && quietHoursRaw?.end) {
      const agentTz = quietHoursRaw.timezone ?? "UTC";
      const attrs = user.attributes as Record<string, unknown>;
      const userTz = typeof attrs?.timezone === "string" ? attrs.timezone : agentTz;
      if (isInQuietHours(quietHoursRaw.start, quietHoursRaw.end, userTz, now)) {
        return { suppressed: true, reason: "quiet_hours" };
      }
    }

    // 4a-b. Quiet days — suppress sends on specific days of week (independent of time-based quiet hours)
    const quietDaysRaw = quietHoursRaw?.quietDays ?? [];
    if (quietDaysRaw.length > 0) {
      const agentTz2 = quietHoursRaw?.timezone ?? "UTC";
      const attrs2 = user.attributes as Record<string, unknown>;
      const userTz2 = typeof attrs2?.timezone === "string" ? attrs2.timezone : agentTz2;
      if (isQuietDay(quietDaysRaw, userTz2, now)) {
        return { suppressed: true, reason: "quiet_hours" };
      }
    }

    // 4b. Frequency cap — count recent decisions in the configured window
    const freqCap = parseFrequencyCap(rule.frequencyCap);
    if (typeof freqCap?.maxSends === "number") {
      const periodMs: Record<string, number> = {
        day:    86_400_000,
        week:   7  * 86_400_000,
        biweek: 14 * 86_400_000,
        month:  30 * 86_400_000,
      };
      const windowStart = new Date(now.getTime() - (periodMs[freqCap.period ?? "week"] ?? periodMs.week));
      const recentCount = await prisma.userDecision.count({
        where: { agentId, userId: externalUserId, sentAt: { gte: windowStart } },
      });
      if (recentCount >= freqCap.maxSends) {
        return { suppressed: true, reason: "frequency_cap" };
      }
    }

    // 4c. Smart suppression — suppress chronically low-reward users
    if (rule.smartSuppress && user.totalDecisions >= 5) {
      const avgReward = user.totalReward / user.totalDecisions;
      if (avgReward < -rule.suppressThresh) {
        return { suppressed: true, reason: "smart_suppression" };
      }
    }
  }

  // 5. Load/seed arm stats for every active variant.
  const isLinUCB = agent.algorithm === "linucb";
  let selectedVariantId: string;
  // Hoisted so decisionContext can include it for LinUCB reward path
  let featureVec: number[] | null = null;

  if (isLinUCB) {
    // LinUCB: load/seed LinUCBArm rows (keyed by agentId+variantId, no persona segmentation).
    const linUCB = new LinUCB();
    const linUCBArms = await Promise.all(
      variants.map(async (v) => {
        const initial = linUCB.initialArm(FEATURE_DIM);
        const row = await prisma.linUCBArm.upsert({
          where: { agentId_variantId: { agentId, variantId: v.id } },
          create: { agentId, variantId: v.id, aInv: initial.aInv, b: initial.b, tries: 0 },
          update: {},
        });
        // If the stored arm was fit in the old feature space (wrong dimension), reset it in DB.
        const storedAInv = row.aInv as number[];
        if (storedAInv.length !== FEATURE_DIM * FEATURE_DIM) {
          await prisma.linUCBArm.update({
            where: { agentId_variantId: { agentId, variantId: v.id } },
            data: { aInv: initial.aInv as unknown as Prisma.InputJsonValue, b: initial.b as unknown as Prisma.InputJsonValue, tries: 0 },
          });
          return { id: v.id, ...initial };
        }
        return { id: v.id, aInv: storedAInv, b: row.b as number[] };
      })
    );

    // Build user feature vector (behavioral + semantic) for context
    featureVec = computeFeatureVector({
      totalDecisions: user.totalDecisions,
      totalConversions: user.totalConversions,
      totalReward: user.totalReward,
      channelStats: user.channelStats,
      hourlyStats: user.hourlyStats,
      dailyStats: user.dailyStats,
      attributes: (user.attributes as Record<string, unknown>) ?? {},
    });

    // linUCBArms is non-empty (built from the guaranteed-non-empty variants list)
    selectedVariantId = selectVariant({ algorithm: "linucb", linucbArms: linUCBArms, context: featureVec })!;
  } else {
    // Thompson Sampling or Epsilon-Greedy: load/seed PersonaArmStats.
    // Pessimistic Beta(1,30) prior — calibrated to ~3% push CTR (Deezer research).
    // When skipSchedulingChecks is set, the cron route has pre-seeded arm stats so we use
    // findFirst (a pure read — no write lock) to avoid concurrent upsert races.
    const INITIAL_ALPHA = 1;
    const INITIAL_BETA  = 30;
    const armStats: BanditArm[] = await Promise.all(
      variants.map(async (v) => {
        if (skipSchedulingChecks) {
          const existing = await prisma.personaArmStats.findFirst({
            where: { personaId: personaId!, agentId, variantId: v.id },
          });
          const stats = existing ?? await prisma.personaArmStats.create({
            data: { personaId: personaId!, agentId, variantId: v.id, alpha: INITIAL_ALPHA, beta: INITIAL_BETA, tries: 0, wins: 0 },
          });
          return { id: v.id, stats };
        }
        const stats = await prisma.personaArmStats.upsert({
          where: { personaId_agentId_variantId: { personaId: personaId!, agentId, variantId: v.id } },
          create: { personaId: personaId!, agentId, variantId: v.id, alpha: INITIAL_ALPHA, beta: INITIAL_BETA, tries: 0, wins: 0 },
          update: {},
        });
        return { id: v.id, stats };
      })
    );

    // armStats is non-empty (built from the guaranteed-non-empty variants list)
    selectedVariantId = selectVariant(
      agent.algorithm === "epsilon_greedy"
        ? { algorithm: "epsilon_greedy", arms: armStats, epsilon: agent.epsilon }
        : { algorithm: "thompson", arms: armStats },
    )!;
  }

  const selected = variants.find((v) => v.id === selectedVariantId);
  if (!selected) throw new Error(`Selected variant ${selectedVariantId} not found — may have been deleted during cron run`);

  // 6. Compute recommended send hour from user's app-usage hourly curve
  const recommendedSendHour = peakActivityHour(user.hourlyStats);

  // 7. Record the decision (include context snapshot for analysis and oracle training)
  // For LinUCB agents, also persist the feature vector so the reward path can apply
  // the Sherman-Morrison update with the same context used at selection time.
  const decisionContextData: Record<string, unknown> = context ? { ...context } : {};
  if (isLinUCB && featureVec !== null) {
    decisionContextData.contextVector = featureVec;
  }
  const decision = await prisma.userDecision.create({
    data: {
      agentId,
      userId: externalUserId,   // stores externalId (existing convention in this codebase)
      messageVariantId: selected.id,
      channel: selected.channel,
      decisionContext: Object.keys(decisionContextData).length > 0
        ? (decisionContextData as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  return {
    suppressed: false,
    brazeVariantId: selected.brazeVariantId ?? null,
    deeplink: selected.deeplink ?? null,
    messageVariantId: selected.id,
    channel: selected.channel,
    userDecisionId: decision.id,
    recommendedSendHour,
  };
}
