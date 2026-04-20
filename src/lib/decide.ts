import { ThompsonSampling } from "@/lib/engine/thompson-sampling";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";
import { assignUserToPersona } from "@/lib/engine/persona-assignment";
import { prisma } from "@/lib/db";
import type { BanditArm } from "@/lib/engine/types";

export type DecideInput = {
  agentId: string;
  externalUserId: string;
};

export type DecideResult =
  | { suppressed: true; reason: "quiet_hours" | "frequency_cap" | "smart_suppression" }
  | {
      suppressed: false;
      brazeVariantId: string | null;
      messageVariantId: string;
      channel: string;
      userDecisionId: string;
    };

/**
 * Core bandit decision function. Shared by /api/decide and /api/cron/select-and-send.
 *
 * Returns null when the agent doesn't exist, is inactive, or has no active variants.
 * Returns DecideResult otherwise (may be suppressed if scheduling rules block the send).
 */
export async function decideForUser(input: DecideInput): Promise<DecideResult | null> {
  const { agentId, externalUserId } = input;

  // 1. Fetch agent with all active variants and scheduling rule
  const agent = await prisma.agent.findFirst({
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

  // 2. Upsert user (create on first decision, no-op on update)
  const user = await prisma.user.upsert({
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

  // 4. Scheduling rule checks
  const rule = agent.schedulingRule;
  const now = new Date();

  if (rule) {
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
    if (freqCap?.maxSends) {
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

  // 5. Load/seed PersonaArmStats for every active variant
  const armStats: BanditArm[] = await Promise.all(
    variants.map(async (v) => {
      const initialAlpha = agent.algorithm === "thompson" ? 1 : 0;
      const initialBeta  = agent.algorithm === "thompson" ? 1 : 0;
      const stats = await prisma.personaArmStats.upsert({
        where: {
          personaId_agentId_variantId: {
            personaId: personaId!,
            agentId,
            variantId: v.id,
          },
        },
        create: {
          personaId: personaId!,
          agentId,
          variantId: v.id,
          alpha: initialAlpha,
          beta:  initialBeta,
          tries: 0,
          wins:  0,
        },
        update: {}, // never overwrite existing stats
      });
      return { id: v.id, stats };
    })
  );

  // 6. Run bandit algorithm
  const result =
    agent.algorithm === "epsilon_greedy"
      ? new EpsilonGreedy(agent.epsilon).select(armStats)
      : new ThompsonSampling().select(armStats);

  const selected = variants.find((v) => v.id === result.variantId)!;

  // 7. Record the decision
  const decision = await prisma.userDecision.create({
    data: {
      agentId,
      userId: externalUserId,   // stores externalId (existing convention in this codebase)
      messageVariantId: selected.id,
      channel: selected.channel,
    },
  });

  return {
    suppressed: false,
    brazeVariantId: selected.brazeVariantId ?? null,
    messageVariantId: selected.id,
    channel: selected.channel,
    userDecisionId: decision.id,
  };
}
