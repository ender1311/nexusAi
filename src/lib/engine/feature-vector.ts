/**
 * Computes a 44-float feature vector from User behavioral stats and semantic attributes.
 *
 * Layout:
 *  [0-2]   Channel affinity: push/email/sms conversion rates (3 dims)
 *  [3-26]  Hour-of-day response curve, normalized (24 dims)
 *  [27-33] Day-of-week curve, normalized (7 dims)
 *  [34]    Overall conversion rate
 *  [35]    Engagement frequency (log-scaled decisions/week estimate)
 *  [36]    Avg reward magnitude
 *
 * Semantic signals from User.attributes (Hightouch-synced YouVersion properties):
 *  [37]    Giver tier (0=none, 0.5=giver, 1.0=sower)
 *  [38]    Streak depth — plan_day_current_month_count / 31
 *  [39]    Recency score — 1 - min(1, days_since_last_open / 90)
 *  [40]    Plan depth — log(1 + plan_finish_lifetime_count) / log(501)
 *  [41]    Prayer depth — gp_current_month_count / 30
 *  [42]    Scripture depth — gs_current_month_count / 30
 *  [43]    Badge depth — log(1 + badge_lifetime_count) / log(201)
 */

const CHANNELS = ["push", "email", "sms"] as const;
const FEATURE_DIM = 44;

export interface UserStatsInput {
  totalDecisions: number;
  totalConversions: number;
  totalReward: number;
  channelStats: unknown;
  hourlyStats: unknown;
  dailyStats: unknown;
  /** Semantic attributes synced from YouVersion via Hightouch (User.attributes JSON blob) */
  attributes?: Record<string, unknown>;
}

function normalize(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum === 0) return arr.map(() => 0);
  return arr.map((v) => v / sum);
}

export function computeFeatureVector(stats: UserStatsInput): number[] {
  const vec = new Array<number>(FEATURE_DIM).fill(0);

  // [0-2] Channel conversion rates
  const channelStats = (stats.channelStats as Record<string, { sent: number; converted: number }>) ?? {};
  CHANNELS.forEach((ch, i) => {
    const cs = channelStats[ch];
    if (cs && cs.sent > 0) {
      vec[i] = cs.converted / cs.sent;
    }
  });

  // [3-26] Hourly curve (normalized)
  const rawHourly = (stats.hourlyStats as number[]) ?? [];
  const hourly = Array(24).fill(0);
  for (let h = 0; h < 24; h++) hourly[h] = rawHourly[h] ?? 0;
  const normHourly = normalize(hourly);
  for (let h = 0; h < 24; h++) vec[3 + h] = normHourly[h];

  // [27-33] Daily curve (normalized)
  const rawDaily = (stats.dailyStats as number[]) ?? [];
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

  // --- Semantic signals from User.attributes (Hightouch-synced YouVersion properties) ---
  const attrs = stats.attributes ?? {};
  const num = (key: string): number => {
    const v = attrs[key];
    return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0;
  };
  const str = (key: string): string => {
    const v = attrs[key];
    return typeof v === "string" ? v : "";
  };

  // [37] Giver tier — 0=none, 0.5=giver, 1.0=sower
  const giverTier = str("giving_tier").toLowerCase();
  vec[37] = giverTier === "sower" ? 1.0 : giverTier === "giver" ? 0.5 : 0.0;

  // [38] Streak depth — how far into this month's daily reading plan the user is
  vec[38] = Math.min(1, num("plan_day_current_month_count") / 31);

  // [39] Recency score — inverted days-since-last-open; 0 = unknown or 90+ days ago, 1 = today
  // Only set if the attribute is present; absent = no signal (leave as 0).
  if (attrs["days_since_last_open"] !== undefined && attrs["days_since_last_open"] !== null) {
    vec[39] = 1 - Math.min(1, num("days_since_last_open") / 90);
  }

  // [40] Plan depth — lifetime plans finished (log-scaled; 500 finishes ≈ power user)
  vec[40] = Math.log(1 + num("plan_finish_lifetime_count")) / Math.log(501);

  // [41] Prayer depth — guided-prayer sessions this month
  vec[41] = Math.min(1, num("gp_current_month_count") / 30);

  // [42] Scripture depth — guided-scripture sessions this month
  vec[42] = Math.min(1, num("gs_current_month_count") / 30);

  // [43] Badge depth — lifetime badge count (log-scaled; 200 badges ≈ power user)
  vec[43] = Math.log(1 + num("badge_lifetime_count")) / Math.log(201);

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
