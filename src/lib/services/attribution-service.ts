import { prisma } from "@/lib/db";
import { calculateReward } from "@/lib/engine/reward-calculator";
import { accumulateUserStats } from "@/lib/services/user-stats-service";
import { upsertArmStats, upsertUserArmStats, updateLinUCBArm } from "@/lib/arm-stats";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { Goal } from "@/types/agent";

type DecisionForAttribution = {
  id: string;
  agentId: string;
  userId: string;
  channel: string;
  messageVariantId: string | null;
  decisionContext: unknown;
  // Prisma returns tier/weightMode as string; cast to Goal[] when calling calculateReward.
  agent: { algorithm: string; goals: Record<string, unknown>[] };
};

/**
 * Apply a credited conversion to a specific decision: compute reward, mark the
 * decision converted, update PersonaArmStats / UserArmStats / LinUCBArm, and
 * release the owning UserAgentAssignment if the credited agent currently owns
 * the user (releaseReason "conversion"). Arm-update and stats failures are
 * caught/logged so one failure never aborts the caller's batch.
 */
export async function applyConversion(args: {
  decision: DecisionForAttribution;
  conversionEvent: string;
  occurredAt: Date;
  properties?: Record<string, unknown>;
  // When the caller already knows the user's personaId, pass it to skip the
  // per-call trackedUser lookup below (avoids an N+1 in batch ingest). Pass
  // null to mean "known to have no persona"; omit to fall back to the lookup.
  personaId?: string | null;
}): Promise<{ reward: number }> {
  const { decision, conversionEvent, occurredAt, properties } = args;

  const reward = calculateReward(conversionEvent, decision.agent.goals as unknown as Goal[], properties);

  await prisma.userDecision.update({
    where: { id: decision.id },
    data: {
      conversionEvent,
      conversionAt: occurredAt,
      reward: reward !== 0 ? reward : null,
    },
  });

  if (reward !== 0) {
    await accumulateUserStats({
      externalId: decision.userId,
      channel: decision.channel,
      reward,
      occurredAt,
    }).catch((err) => console.error("[attribution] accumulateUserStats failed:", err));
  }

  if (decision.messageVariantId) {
    const variantId = decision.messageVariantId;
    const personaId = args.personaId !== undefined
      ? args.personaId
      : (await prisma.trackedUser.findFirst({
          where: { externalId: decision.userId },
          select: { personaId: true },
        }))?.personaId ?? null;
    const deltaAlpha = reward > 0 ? reward : 0;
    const deltaBeta  = reward <= 0 ? 1 : 0;
    const deltaWins  = reward > 0 ? 1 : 0;

    await Promise.all([
      personaId
        ? upsertArmStats({
            personaId, agentId: decision.agentId, variantId,
            deltaAlpha, deltaBeta, deltaWins,
          }).catch((err) => console.error("[attribution] PersonaArmStats failed:", err))
        : Promise.resolve(),
      upsertUserArmStats({
        userId: decision.userId, agentId: decision.agentId, variantId,
        deltaAlpha, deltaBeta, deltaWins,
      }).catch((err) => console.error("[attribution] UserArmStats failed:", err)),
    ]);

    if (decision.agent.algorithm === "linucb") {
      const ctx = decision.decisionContext as Record<string, unknown> | null;
      const rawVec = ctx?.contextVector;
      const contextVec =
        Array.isArray(rawVec) && rawVec.length === FEATURE_DIM && (rawVec as number[]).every(Number.isFinite)
          ? (rawVec as number[])
          : null;
      if (contextVec) {
        await updateLinUCBArm({
          agentId: decision.agentId, variantId, contextVec, reward,
        }).catch((err) => console.error("[attribution] LinUCBArm failed:", err));
      }
    }
  }

  // Release-on-conversion: only if the credited agent currently owns the user.
  await prisma.userAgentAssignment.updateMany({
    where: { externalUserId: decision.userId, agentId: decision.agentId, releasedAt: null },
    data: { releasedAt: occurredAt, releaseReason: "conversion" },
  }).catch((err) => console.error("[attribution] release-on-conversion failed:", err));

  return { reward };
}
