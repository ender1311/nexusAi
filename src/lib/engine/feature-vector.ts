/**
 * Computes a 37-float feature vector from User behavioral stats.
 *
 * Layout:
 *  [0-2]   Channel affinity: push/email/sms conversion rates (3 dims)
 *  [3-26]  Hour-of-day response curve, normalized (24 dims)
 *  [27-33] Day-of-week curve, normalized (7 dims)
 *  [34]    Overall conversion rate
 *  [35]    Engagement frequency (log-scaled decisions/week estimate)
 *  [36]    Avg reward magnitude
 */

const CHANNELS = ["push", "email", "sms"] as const;
const FEATURE_DIM = 37;

export interface UserStatsInput {
  totalDecisions: number;
  totalConversions: number;
  totalReward: number;
  channelStats: string; // JSON: {push:{sent,converted}, email:..., sms:...}
  hourlyStats: string;  // JSON: number[24]
  dailyStats: string;   // JSON: number[7]
}

function normalize(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum === 0) return arr.map(() => 0);
  return arr.map((v) => v / sum);
}

export function computeFeatureVector(stats: UserStatsInput): number[] {
  const vec = new Array<number>(FEATURE_DIM).fill(0);

  // [0-2] Channel conversion rates
  const channelStats: Record<string, { sent: number; converted: number }> = JSON.parse(
    stats.channelStats || "{}"
  );
  CHANNELS.forEach((ch, i) => {
    const cs = channelStats[ch];
    if (cs && cs.sent > 0) {
      vec[i] = cs.converted / cs.sent;
    }
  });

  // [3-26] Hourly curve (normalized)
  const rawHourly: number[] = JSON.parse(stats.hourlyStats || "[]");
  const hourly = Array(24).fill(0);
  for (let h = 0; h < 24; h++) hourly[h] = rawHourly[h] ?? 0;
  const normHourly = normalize(hourly);
  for (let h = 0; h < 24; h++) vec[3 + h] = normHourly[h];

  // [27-33] Daily curve (normalized)
  const rawDaily: number[] = JSON.parse(stats.dailyStats || "[]");
  const daily = Array(7).fill(0);
  for (let d = 0; d < 7; d++) daily[d] = rawDaily[d] ?? 0;
  const normDaily = normalize(daily);
  for (let d = 0; d < 7; d++) vec[27 + d] = normDaily[d];

  // [34] Overall conversion rate
  vec[34] = stats.totalDecisions > 0 ? stats.totalConversions / stats.totalDecisions : 0;

  // [35] Engagement frequency (log-scaled)
  // Assume stats span ~4 weeks on average; normalize log(decisions/week)
  const decisionsPerWeek = stats.totalDecisions / 4;
  vec[35] = decisionsPerWeek > 0 ? Math.log(1 + decisionsPerWeek) / Math.log(1 + 100) : 0;

  // [36] Avg reward magnitude
  const avgReward =
    stats.totalConversions > 0 ? Math.abs(stats.totalReward / stats.totalConversions) : 0;
  vec[36] = Math.min(1, avgReward);

  return vec;
}

/** Cosine similarity between two vectors of the same length */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export { FEATURE_DIM };
