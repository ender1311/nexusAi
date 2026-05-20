import { computeFeatureVector, cosineSimilarity, FEATURE_DIM } from "./feature-vector";
import { prisma } from "@/lib/db";

export interface DiscoveryConfig {
  minInteractions?: number;   // default 20
  minK?: number;              // default 3
  maxK?: number;              // default 15
  stabilityRuns?: number;     // default 5
  stabilityThreshold?: number; // default 0.85
  minSilhouetteScore?: number; // default 0.25
}

interface ClusterResult {
  k: number;
  centroids: number[][];
  assignments: number[];
  silhouetteScore: number;
}

function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

function centroidOf(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array(FEATURE_DIM).fill(0);
  const sum = new Array(FEATURE_DIM).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < FEATURE_DIM; i++) sum[i] += v[i];
  }
  return sum.map((x) => x / vectors.length);
}

export function kMeansOnce(vectors: number[][], k: number): { centroids: number[][]; assignments: number[] } {
  if (vectors.length <= k) {
    const centroids = vectors.slice(0, k);
    while (centroids.length < k) centroids.push(new Array(FEATURE_DIM).fill(0));
    return { centroids, assignments: vectors.map((_, i) => i % k) };
  }

  // K-means++ initialization
  const centroids: number[][] = [];
  const randIdx = Math.floor(Math.random() * vectors.length);
  centroids.push([...vectors[randIdx]]);

  while (centroids.length < k) {
    const distances = vectors.map((v) => {
      const minDist = Math.min(...centroids.map((c) => cosineDistance(v, c)));
      return minDist ** 2;
    });
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    let chosen = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) { chosen = i; break; }
    }
    centroids.push([...vectors[chosen]]);
  }

  let assignments = new Array(vectors.length).fill(0);
  const MAX_ITER = 100;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Assign
    const newAssignments = vectors.map((v) => {
      let bestK = 0, bestDist = Infinity;
      for (let j = 0; j < k; j++) {
        const d = cosineDistance(v, centroids[j]);
        if (d < bestDist) { bestDist = d; bestK = j; }
      }
      return bestK;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Update centroids
    for (let j = 0; j < k; j++) {
      const clusterVecs = vectors.filter((_, i) => assignments[i] === j);
      if (clusterVecs.length > 0) {
        centroids[j] = centroidOf(clusterVecs);
      }
    }
  }

  return { centroids, assignments };
}

export function computeSilhouette(vectors: number[][], assignments: number[], k: number): number {
  if (vectors.length < 2 * k) return 0;
  const scores: number[] = [];

  for (let i = 0; i < vectors.length; i++) {
    const myCluster = assignments[i];
    const sameCluster = vectors.filter((_, j) => j !== i && assignments[j] === myCluster);
    if (sameCluster.length === 0) { scores.push(0); continue; }

    const a = sameCluster.reduce((sum, v) => sum + cosineDistance(vectors[i], v), 0) / sameCluster.length;

    let minOtherAvg = Infinity;
    for (let j = 0; j < k; j++) {
      if (j === myCluster) continue;
      const otherCluster = vectors.filter((_, idx) => assignments[idx] === j);
      if (otherCluster.length === 0) continue;
      const avgDist = otherCluster.reduce((sum, v) => sum + cosineDistance(vectors[i], v), 0) / otherCluster.length;
      if (avgDist < minOtherAvg) minOtherAvg = avgDist;
    }

    const b = minOtherAvg === Infinity ? 0 : minOtherAvg;
    const s = Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
    scores.push(s);
  }

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Run k-means for a given k, multiple times for stability */
export function runKMeans(vectors: number[][], k: number, runs: number): ClusterResult {
  let best: { centroids: number[][]; assignments: number[]; score: number } | null = null;

  for (let r = 0; r < runs; r++) {
    const { centroids, assignments } = kMeansOnce(vectors, k);
    const score = computeSilhouette(vectors, assignments, k);
    if (!best || score > best.score) {
      best = { centroids, assignments, score };
    }
  }

  return {
    k,
    centroids: best!.centroids,
    assignments: best!.assignments,
    silhouetteScore: best!.score,
  };
}

export function deriveTrait(centroid: number[]): {
  dominantChannel: string;
  peakHour: number;
  engagementLevel: string;
  conversionRate: number;
  giverProfile: string;
  streakDepth: number;
  planDepth: number;
} {
  const CHANNELS = ["push", "email", "sms"];
  const channelRates = centroid.slice(0, 3);
  const dominantChannelIdx = channelRates.indexOf(Math.max(...channelRates));
  const dominantChannel = CHANNELS[dominantChannelIdx] ?? "push";

  const hourlyRates = centroid.slice(3, 27);
  const peakHour = hourlyRates.indexOf(Math.max(...hourlyRates));

  const conversionRate = centroid[34] ?? 0;
  const freq = centroid[35] ?? 0;

  let engagementLevel = "sporadic";
  if (freq > 0.7) engagementLevel = "daily";
  else if (freq > 0.5) engagementLevel = "regular";
  else if (freq > 0.3) engagementLevel = "moderate";
  else if (freq > 0.15) engagementLevel = "weekly";

  // Semantic dims [37-43]
  const giverScore = centroid[37] ?? 0;
  const giverProfile = giverScore >= 0.9 ? "sower" : giverScore >= 0.4 ? "giver" : "non-giver";
  const streakDepth = centroid[38] ?? 0;
  const planDepth = centroid[40] ?? 0;

  return { dominantChannel, peakHour, engagementLevel, conversionRate, giverProfile, streakDepth, planDepth };
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
  const minInteractions = config.minInteractions ?? 20;
  const minK = config.minK ?? 3;
  const maxK = config.maxK ?? 15;
  const stabilityRuns = config.stabilityRuns ?? 5;

  // Fetch users with enough data
  const eligibleUsers = await prisma.trackedUser.findMany({
    where: { totalDecisions: { gte: minInteractions } },
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

  // Find optimal k using silhouette score
  const effectiveMaxK = Math.min(maxK, Math.floor(vectors.length / 2));
  let bestResult: ClusterResult | null = null;

  for (let k = minK; k <= effectiveMaxK; k++) {
    const result = runKMeans(vectors, k, stabilityRuns);
    if (!bestResult || result.silhouetteScore > bestResult.silhouetteScore) {
      bestResult = result;
    }
  }

  if (!bestResult) {
    return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore: 0, k: 0 };
  }

  const minSilhouetteScore = config.minSilhouetteScore ?? 0.25;
  if (bestResult.silhouetteScore < minSilhouetteScore) {
    console.warn(
      `[persona-discovery] best silhouette score ${bestResult.silhouetteScore.toFixed(4)} is below threshold ${minSilhouetteScore}; skipping persona creation`
    );
    return { personasCreated: 0, personasUpdated: 0, usersAssigned: 0, silhouetteScore: bestResult.silhouetteScore, k: 0 };
  }

  // Get existing discovered personas to update vs create
  const existingDiscovered = await prisma.persona.findMany({
    where: { source: "discovered", isActive: true },
  });

  const clusterSizes = new Array(bestResult.k).fill(0);
  bestResult.assignments.forEach((a) => clusterSizes[a]++);

  let personasCreated = 0;
  let personasUpdated = 0;
  const personaIds: string[] = [];

  for (let j = 0; j < bestResult.k; j++) {
    const centroid = bestResult.centroids[j];
    const traits = deriveTrait(centroid);
    const clusterSize = clusterSizes[j];

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
          clusterSize,
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
          clusterSize,
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
