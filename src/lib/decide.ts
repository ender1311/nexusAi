import { ThompsonSampling } from "@/lib/engine/thompson-sampling";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";
import { LinUCB } from "@/lib/engine/lin-ucb";
import { assignUserToPersona } from "@/lib/engine/persona-assignment";
import { computeFeatureVector } from "@/lib/engine/feature-vector";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import { prisma } from "@/lib/db";
import type { BanditArm, LinUCBArm } from "@/lib/engine/types";
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
      messageVariantId: string;
      channel: string;
      userDecisionId: string;
      /** Best send hour (0-23) derived from user's hourlyStats app-usage curve; null if no data */
      recommendedSendHour: number | null;
    };

/** Compute optimal send hour from a user's hourly engagement curve (24-element array). */
function computeOptimalSendHour(hourlyStats: unknown): number | null {
  const raw = Array.isArray(hourlyStats) ? (hourlyStats as number[]) : [];
  if (raw.length === 0) return null;
  let best = -1, bestVal = -1;
  for (let h = 0; h < Math.min(24, raw.length); h++) {
    const v = typeof raw[h] === "number" ? raw[h] : 0;
    if (v > bestVal) { bestVal = v; best = h; }
  }
  return bestVal > 0 ? best : null;
}

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

  // 2. Fetch or create user (upsert for /api/decide; findUnique when called from cron
  // where user is guaranteed to exist, avoiding an unnecessary write round-trip)
  const user = skipSchedulingChecks
    ? await prisma.trackedUser.findUnique({ where: { externalId: externalUserId } }) ??
      await prisma.trackedUser.create({ data: { externalId: externalUserId } })
    : await prisma.trackedUser.upsert({
        where: { externalId: externalUserId },
        create: { externalId: externalUserId },
        update: {},
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

  // 4. Scheduling rule checks (skipped when caller has already performed them)
  const rule = agent.schedulingRule;
  const now = new Date();

  if (rule && !skipSchedulingChecks) {
    // 4a. Quiet hours
    const quietHours = rule.quietHours as unknown as { start?: string; end?: string; timezone?: string };
    if (quietHours?.start && quietHours?.end) {
      const tzTime = new Intl.DateTimeFormat("en-US", {
        timeZone: quietHours.timezone ?? "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);
      const { start, end } = quietHours;
      // Handle overnight windows (e.g., 22:00–08:00)
      const inQuiet =
        start > end
          ? tzTime >= start || tzTime < end
          : tzTime >= start && tzTime < end;
      if (inQuiet) return { suppressed: true, reason: "quiet_hours" };
    }

    // 4b. Frequency cap — count recent decisions in the configured window
    const freqCap = rule.frequencyCap as unknown as { maxSends?: number; period?: string } | null;
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

  if (isLinUCB) {
    // LinUCB: load/seed LinUCBArm rows; select using user feature vector as context.
    const linUCB = new LinUCB(1.0, 1.0, FEATURE_DIM);
    const linUCBArms: LinUCBArm[] = await Promise.all(
      variants.map(async (v) => {
        const initialStats = linUCB.initialStats();
        const row = await prisma.linUCBArm.upsert({
          where: { personaId_agentId_variantId: { personaId: personaId!, agentId, variantId: v.id } },
          create: {
            personaId: personaId!,
            agentId,
            variantId: v.id,
            aInv: initialStats.aInv,
            b: initialStats.b,
            tries: 0,
          },
          update: {},
        });
        return {
          id: v.id,
          linucbStats: {
            aInv: row.aInv as number[],
            b: row.b as number[],
            tries: row.tries,
          },
        };
      })
    );

    // Build user feature vector (behavioral + semantic) for context
    const featureVec = computeFeatureVector({
      totalDecisions: user.totalDecisions,
      totalConversions: user.totalConversions,
      totalReward: user.totalReward,
      channelStats: user.channelStats,
      hourlyStats: user.hourlyStats,
      dailyStats: user.dailyStats,
      attributes: (user.attributes as Record<string, unknown>) ?? {},
    });

    const result = linUCB.select(linUCBArms, featureVec);
    selectedVariantId = result.variantId;
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

    const result =
      agent.algorithm === "epsilon_greedy"
        ? new EpsilonGreedy(agent.epsilon).select(armStats)
        : new ThompsonSampling().select(armStats);
    selectedVariantId = result.variantId;
  }

  const selected = variants.find((v) => v.id === selectedVariantId)!;

  // 6. Compute recommended send hour from user's app-usage hourly curve
  const recommendedSendHour = computeOptimalSendHour(user.hourlyStats);

  // 7. Record the decision (include context snapshot for analysis and oracle training)
  const decision = await prisma.userDecision.create({
    data: {
      agentId,
      userId: externalUserId,   // stores externalId (existing convention in this codebase)
      messageVariantId: selected.id,
      channel: selected.channel,
      decisionContext: context ?? undefined,
    },
  });

  return {
    suppressed: false,
    brazeVariantId: selected.brazeVariantId ?? null,
    messageVariantId: selected.id,
    channel: selected.channel,
    userDecisionId: decision.id,
    recommendedSendHour,
  };
}
