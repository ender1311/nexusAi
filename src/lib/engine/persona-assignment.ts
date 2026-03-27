import { computeFeatureVector, cosineSimilarity } from "./feature-vector";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export interface AssignmentConfig {
  minInteractions?: number;    // default 20
  confidenceThreshold?: number; // default 0.75
}

/**
 * Assign a single user to the best matching persona based on their feature vector.
 * Low-data users get a reduced effective confidence.
 */
export async function assignUserToPersona(
  externalId: string,
  config: AssignmentConfig = {}
): Promise<{ personaId: string | null; confidence: number }> {
  const minInteractions = config.minInteractions ?? 20;
  const threshold = config.confidenceThreshold ?? 0.75;

  const user = await prisma.user.findUnique({ where: { externalId } });
  if (!user) return { personaId: null, confidence: 0 };

  const discoveredPersonas = await prisma.persona.findMany({
    where: { source: "discovered", isActive: true, centroid: { not: Prisma.DbNull } },
  });

  if (discoveredPersonas.length === 0) return { personaId: null, confidence: 0 };

  const userVec = computeFeatureVector({
    totalDecisions: user.totalDecisions,
    totalConversions: user.totalConversions,
    totalReward: user.totalReward,
    channelStats: user.channelStats,
    hourlyStats: user.hourlyStats,
    dailyStats: user.dailyStats,
  });

  let bestPersonaId: string | null = null;
  let bestSimilarity = 0;

  for (const persona of discoveredPersonas) {
    if (!persona.centroid) continue;
    const centroid = persona.centroid as number[];
    const similarity = cosineSimilarity(userVec, centroid);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestPersonaId = persona.id;
    }
  }

  // Scale confidence by data richness for low-data users
  const dataRatio = Math.min(1, user.totalDecisions / minInteractions);
  const effectiveConfidence = bestSimilarity * dataRatio;

  if (effectiveConfidence >= threshold && bestPersonaId) {
    await prisma.user.update({
      where: { externalId },
      data: {
        personaId: bestPersonaId,
        personaConfidence: effectiveConfidence,
        personaAssignedAt: new Date(),
      },
    });
    return { personaId: bestPersonaId, confidence: effectiveConfidence };
  }

  return { personaId: null, confidence: effectiveConfidence };
}

/**
 * Batch assign all eligible users to personas.
 * Returns count of assignments made.
 */
export async function batchAssignPersonas(config: AssignmentConfig = {}): Promise<number> {
  const users = await prisma.user.findMany({ select: { externalId: true } });
  let assigned = 0;

  for (const user of users) {
    const result = await assignUserToPersona(user.externalId, config);
    if (result.personaId) assigned++;
  }

  return assigned;
}
