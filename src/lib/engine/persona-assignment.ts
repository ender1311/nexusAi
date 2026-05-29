import { computeFeatureVector, cosineSimilarity } from "./feature-vector";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export interface AssignmentConfig {
  minInteractions?: number;    // default 20; used to scale confidence — does not gate assignment
}

/**
 * Assign a single user to the best matching persona based on their feature vector.
 * Low-data users get a reduced effective confidence.
 */
type DiscoveredPersona = Awaited<ReturnType<typeof prisma.persona.findMany>>[number];

/**
 * Pick the persona whose centroid has the highest cosine similarity to the
 * user vector. Cosine similarity is in [-1, 1], so the search must start below
 * -1 — initializing at 0 would discard every user whose nearest centroid is a
 * negative (but still closest) match, dropping them to the largest-persona
 * fallback instead of their true nearest persona.
 */
export function selectNearestPersona(
  userVec: number[],
  personas: { id: string; centroid: number[] | null }[],
): { personaId: string | null; similarity: number } {
  let bestPersonaId: string | null = null;
  let bestSimilarity = -Infinity;
  for (const persona of personas) {
    if (!persona.centroid) continue;
    const similarity = cosineSimilarity(userVec, persona.centroid);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestPersonaId = persona.id;
    }
  }
  return { personaId: bestPersonaId, similarity: bestPersonaId === null ? 0 : bestSimilarity };
}

export async function assignUserToPersona(
  externalId: string,
  config: AssignmentConfig = {},
  preloadedPersonas?: DiscoveredPersona[]
): Promise<{ personaId: string | null; confidence: number }> {
  const minInteractions = config.minInteractions ?? 20;

  const user = await prisma.trackedUser.findUnique({ where: { externalId } });
  if (!user) return { personaId: null, confidence: 0 };

  const discoveredPersonas = preloadedPersonas ?? await prisma.persona.findMany({
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
    attributes: (user.attributes as Record<string, unknown>) ?? {},
  });

  const { personaId: bestPersonaId, similarity: bestSimilarity } = selectNearestPersona(
    userVec,
    discoveredPersonas.map((p) => ({ id: p.id, centroid: (p.centroid as number[] | null) })),
  );

  // Scale confidence by data richness for low-data users. Clamp similarity at 0
  // so a negative-cosine nearest match can't yield a negative confidence.
  const dataRatio = Math.min(1, user.totalDecisions / minInteractions);
  const effectiveConfidence = Math.max(0, bestSimilarity) * dataRatio;

  // Always assign to nearest persona — confidence is recorded but does not gate assignment.
  // Users with no behavioral signal fall back to the largest persona (best population prior).
  let assignId = bestPersonaId;
  if (assignId === null) {
    assignId = discoveredPersonas.sort((a, b) => b.clusterSize - a.clusterSize)[0]?.id ?? null;
    console.warn(
      `[persona-assignment] no centroid match for ${externalId}, falling back to largest persona ${assignId}`
    );
  }

  if (assignId) {
    await prisma.trackedUser.update({
      where: { externalId },
      data: {
        personaId: assignId,
        personaConfidence: effectiveConfidence,
        personaAssignedAt: new Date(),
      },
    });
  }

  return { personaId: assignId, confidence: effectiveConfidence };
}

/**
 * Batch assign all eligible users to personas.
 * Returns count of assignments made.
 */
export async function batchAssignPersonas(config: AssignmentConfig = {}): Promise<number> {
  const [users, discoveredPersonas] = await Promise.all([
    prisma.trackedUser.findMany({ select: { externalId: true } }),
    prisma.persona.findMany({
      where: { source: "discovered", isActive: true, centroid: { not: Prisma.DbNull } },
    }),
  ]);

  let assigned = 0;
  const BATCH_SIZE = 50;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((u) => assignUserToPersona(u.externalId, config, discoveredPersonas))
    );
    assigned += results.filter((r) => r.personaId !== null).length;
  }

  return assigned;
}
