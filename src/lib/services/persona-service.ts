import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { computeFeatureVector } from "@/lib/engine/feature-vector";
import { hdbscan } from "@/lib/engine/hdbscan";
import {
  selectNearestPersona,
  type AssignmentConfig,
} from "@/lib/engine/persona-assignment";
import {
  runKMeans,
  computeSilhouette,
  deriveTrait,
  centroidOf,
  type DiscoveryConfig,
  type ClusterResult,
} from "@/lib/engine/persona-discovery";

type DiscoveredPersona = Awaited<ReturnType<typeof prisma.persona.findMany>>[number];

/**
 * Assign a single user to the best matching persona based on their feature vector.
 * Low-data users get a reduced effective confidence.
 */
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
  // Fetch personas first — if none exist there's nothing to assign to.
  const discoveredPersonas = await prisma.persona.findMany({
    where: { source: "discovered", isActive: true, centroid: { not: Prisma.DbNull } },
  });
  if (discoveredPersonas.length === 0) return 0;

  // Fetch all users that need persona assignment in one query, with all fields
  // needed for feature vector computation (avoids N+1 per-user DB calls).
  const users = await prisma.trackedUser.findMany({
    select: {
      externalId: true,
      totalDecisions: true,
      totalConversions: true,
      totalReward: true,
      channelStats: true,
      hourlyStats: true,
      dailyStats: true,
      attributes: true,
    },
  });

  // Compute assignments entirely in memory — no DB call per user.
  const personaMap = discoveredPersonas.map((p) => ({
    id: p.id,
    centroid: p.centroid as number[] | null,
  }));
  const byPersona = new Map<string, string[]>();
  for (const u of users) {
    const vec = computeFeatureVector({
      totalDecisions: u.totalDecisions,
      totalConversions: u.totalConversions,
      totalReward: u.totalReward,
      channelStats: u.channelStats,
      hourlyStats: u.hourlyStats,
      dailyStats: u.dailyStats,
      attributes: (u.attributes as Record<string, unknown>) ?? {},
    });
    const { personaId } = selectNearestPersona(vec, personaMap);
    if (personaId) {
      if (!byPersona.has(personaId)) byPersona.set(personaId, []);
      byPersona.get(personaId)!.push(u.externalId);
    }
  }

  // One updateMany per persona (N_personas queries, not N_users queries).
  const now = new Date();
  await Promise.all(
    [...byPersona.entries()].map(([personaId, externalIds]) =>
      prisma.trackedUser.updateMany({
        where: { externalId: { in: externalIds } },
        data: { personaId, personaAssignedAt: now },
      }),
    ),
  );

  return [...byPersona.values()].reduce((sum, ids) => sum + ids.length, 0);
}

/**
 * Run persona discovery: clusters users with enough data, creates/updates Persona records.
 * Returns discovered persona IDs.
 */
export async function discoverPersonas(config: DiscoveryConfig = {}): Promise<{
  personasCreated: number;
  personasUpdated: number;
  usersAssigned: number;
  silhouetteScore: number;
  k: number;
}> {
  const minInteractions = config.minInteractions ?? 5;
  const minK = config.minK ?? 3;
  const maxK = config.maxK ?? 15;
  const stabilityRuns = config.stabilityRuns ?? 5;
  const algorithm = config.algorithm ?? "hdbscan";
  const maxSampleSize = config.maxSampleSize ?? 3000;
  // Cap the initial DB fetch to avoid loading the entire user table.
  // Fisher-Yates sampling below reduces this further to maxSampleSize.
  const fetchCap = maxSampleSize * 10;

  // Fetch users with enough data — cap to fetchCap rows ordered by most active
  // to avoid loading the full 34M+ User table into memory.
  const eligibleUsers = await prisma.trackedUser.findMany({
    where: { totalDecisions: { gte: minInteractions } },
    orderBy: { totalDecisions: "desc" },
    take: fetchCap,
  });

  if (eligibleUsers.length < minK * 2) {
    return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore: 0, k: 0 };
  }

  // Compute feature vectors (including semantic attributes from Hightouch)
  const vectors = eligibleUsers.map((u) =>
    computeFeatureVector({
      totalDecisions: u.totalDecisions,
      totalConversions: u.totalConversions,
      totalReward: u.totalReward,
      channelStats: u.channelStats,
      hourlyStats: u.hourlyStats,
      dailyStats: u.dailyStats,
      attributes: (u.attributes as Record<string, unknown>) ?? {},
    })
  );

  // Sample down to maxSampleSize using Fisher-Yates when the corpus is large
  let sampleVectors = vectors;
  if (vectors.length > maxSampleSize) {
    const indices = Array.from({ length: vectors.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    const sample = indices.slice(0, maxSampleSize);
    sampleVectors = sample.map((i) => vectors[i]!);
  }

  const minSilhouetteScore = config.minSilhouetteScore ?? 0.25;
  let bestResult: ClusterResult | null = null;

  if (algorithm === "hdbscan") {
    const minPts = config.minPts ?? 5;
    const minClusterSize = config.minClusterSize ?? 30;

    const result = hdbscan(sampleVectors, { minPts, minClusterSize });

    if (result.k === 0) {
      console.warn("[persona-discovery] HDBSCAN found no clusters; returning empty");
      return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore: 0, k: 0 };
    }

    // Compute centroids for each cluster, skipping noise points (label === -1)
    const clusterVectors: number[][][] = Array.from({ length: result.k }, () => []);
    for (let i = 0; i < result.labels.length; i++) {
      const label = result.labels[i]!;
      if (label >= 0) clusterVectors[label]!.push(sampleVectors[i]!);
    }
    const centroids = clusterVectors.map(centroidOf);

    // Compute silhouette only on non-noise points to avoid -1 "cluster" distortion
    const nonNoiseIndices = result.labels.map((l, i) => (l >= 0 ? i : -1)).filter((v) => v >= 0);
    const nonNoiseVectors = nonNoiseIndices.map((i) => sampleVectors[i]!);
    const nonNoiseLabels = nonNoiseIndices.map((i) => result.labels[i]!);
    const silhouetteScore =
      nonNoiseVectors.length >= 2 ? computeSilhouette(nonNoiseVectors, nonNoiseLabels, result.k) : 0;

    // k=1 is valid: computeSilhouette always returns -1 with no other cluster to compare.
    // Accept it without a silhouette gate; the cluster size guard in HDBSCAN already
    // ensures minimum density (minClusterSize).
    if (result.k > 1 && silhouetteScore < minSilhouetteScore) {
      console.warn(
        `[persona-discovery] HDBSCAN silhouette ${silhouetteScore.toFixed(4)} below threshold ${minSilhouetteScore}`
      );
      return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore, k: 0 };
    }

    bestResult = { k: result.k, centroids, assignments: result.labels, silhouetteScore };
  } else {
    // k-means path: find optimal k using silhouette score
    const effectiveMaxK = Math.min(maxK, Math.floor(sampleVectors.length / 2));

    for (let k = minK; k <= effectiveMaxK; k++) {
      const result = runKMeans(sampleVectors, k, stabilityRuns);
      if (!bestResult || result.silhouetteScore > bestResult.silhouetteScore) {
        bestResult = result;
      }
    }

    if (!bestResult) {
      return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore: 0, k: 0 };
    }

    if (bestResult.silhouetteScore < minSilhouetteScore) {
      console.warn(
        `[persona-discovery] best silhouette score ${bestResult.silhouetteScore.toFixed(4)} is below threshold ${minSilhouetteScore}; skipping persona creation`
      );
      return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore: bestResult.silhouetteScore, k: 0 };
    }
  }

  // Get existing discovered personas to update vs create
  const existingDiscovered = await prisma.persona.findMany({
    where: { source: "discovered", isActive: true },
    orderBy: { id: "asc" },
  });

  // Guard against noise assignments (-1) from HDBSCAN corrupting cluster size counts
  const clusterSizes = new Array(bestResult.k).fill(0);
  bestResult.assignments.forEach((a) => { if (a >= 0) clusterSizes[a]++; });

  // Rescale cluster sizes from sample counts to population counts when sampling was applied
  const scaleFactor = vectors.length > maxSampleSize ? eligibleUsers.length / sampleVectors.length : 1;
  const scaledClusterSizes = clusterSizes.map((c) => Math.round(c * scaleFactor));

  let personasCreated = 0;
  let personasUpdated = 0;
  const personaIds: string[] = [];

  for (let j = 0; j < bestResult.k; j++) {
    const centroid = bestResult.centroids[j];
    const traits = deriveTrait(centroid);
    const traitsObj = {
      dominantChannel: traits.dominantChannel,
      peakHour: traits.peakHour,
      engagementLevel: traits.engagementLevel,
      conversionRate: traits.conversionRate,
      giverProfile: traits.giverProfile,
      streakDepth: traits.streakDepth,
      planDepth: traits.planDepth,
    };

    const COLORS = ["blue", "green", "purple", "orange", "teal", "indigo", "amber", "pink"];
    const color = COLORS[j % COLORS.length];

    if (j < existingDiscovered.length) {
      const existing = existingDiscovered[j];
      await prisma.persona.update({
        where: { id: existing.id },
        data: {
          centroid,
          clusterSize: scaledClusterSizes[j],
          silhouetteScore: bestResult.silhouetteScore,
          traits: traitsObj,
          color,
          discoveredAt: new Date(),
        },
      });
      personaIds.push(existing.id);
      personasUpdated++;
    } else {
      const name = `Cluster ${j + 1} — ${traits.engagementLevel} / ${traits.dominantChannel}`;
      const persona = await prisma.persona.create({
        data: {
          name,
          source: "discovered",
          icon: "Users2",
          color,
          centroid,
          clusterSize: scaledClusterSizes[j],
          silhouetteScore: bestResult.silhouetteScore,
          traits: traitsObj,
          discoveredAt: new Date(),
        },
      });
      personaIds.push(persona.id);
      personasCreated++;
    }
  }

  // Deactivate extra old discovered personas
  if (existingDiscovered.length > bestResult.k) {
    for (let j = bestResult.k; j < existingDiscovered.length; j++) {
      await prisma.persona.update({
        where: { id: existingDiscovered[j].id },
        data: { isActive: false },
      });
    }
  }

  return {
    personasCreated,
    personasUpdated,
    usersAssigned: eligibleUsers.length,
    silhouetteScore: bestResult.silhouetteScore,
    k: bestResult.k,
  };
}
