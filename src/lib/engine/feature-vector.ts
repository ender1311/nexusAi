/**
 * Computes a 10-float feature vector from User behavioral stats and semantic attributes.
 *
 * Layout:
 *  [0]   Push conversion rate — push channel conversions / sends
 *  [1]   Email conversion rate — email channel conversions / sends
 *  [2]   Morning engagement ratio — share of daily activity in hours 5–11 (5 am–11 am)
 *  [3]   Evening engagement ratio — share of daily activity in hours 17–22 (5 pm–10 pm)
 *  [4]   Weekend engagement ratio — share of weekly activity on Sun (0) + Sat (6)
 *  [5]   Overall conversion rate — totalConversions / totalDecisions
 *  [6]   Recency score — 1 − min(1, days_since_last_open / 90); absent → 0
 *  [7]   Giving tier — 0 = none, 0.5 = giver, 1.0 = sower
 *  [8]   Spiritual depth — mean(streak, plan, prayer, scripture, badge), all normalized to [0,1]
 *  [9]   Engagement frequency — log(1 + decisions/week) / log(101), ~4-week window
 *
 * Dimensionality reduction roadmap (manual → data-driven):
 *
 *  NEXT SPRINT  Alvaro extracts all User.featureVector rows, runs PCA/NMF analysis in Python,
 *               and measures how many components explain ≥85% of variance in the actual user
 *               population. This determines whether 10 dims or fewer is the right target.
 *
 *  AFTER        Replace this hand-bucketed vector with a PCA or NMF projection matrix stored
 *               as a constant here. The runtime cost is one matrix–vector multiply (dot product)
 *               applied inside computeFeatureVector — no new infrastructure needed.
 *
 *  LONGER TERM  Explore UMAP (to ~8 dims) + HDBSCAN for fully data-driven persona count,
 *               eliminating the need to pick k upfront. Requires enough users for density
 *               estimation to be meaningful.
 *
 * Background: the prior 44-dim layout used 24 hourly + 7 daily histogram bins (31 dims)
 * that were heavily correlated and dominated by a few behavioral patterns. The 10-dim
 * bucketed layout collapses those into interpretable ratios while preserving the same
 * signal groups, improving k-means++ convergence and cosine distance quality.
 */

const FEATURE_DIM = 10;

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

export function computeFeatureVector(stats: UserStatsInput): number[] {
  const vec = new Array<number>(FEATURE_DIM).fill(0);

  // [0] Push conversion rate
  const channelStats = (stats.channelStats as Record<string, { sent: number; converted: number }>) ?? {};
  const push = channelStats["push"];
  if (push && push.sent > 0) vec[0] = push.converted / push.sent;

  // [1] Email conversion rate
  const email = channelStats["email"];
  if (email && email.sent > 0) vec[1] = email.converted / email.sent;

  // [2] Morning ratio — hours 5–11 (5 am–11 am) share of daily activity
  // [3] Evening ratio — hours 17–22 (5 pm–10 pm) share of daily activity
  // Hourly histogram is already normalized (sums to 1 when non-zero), so summing
  // a range gives the fraction of engagement in that window directly.
  const rawHourly = (stats.hourlyStats as number[]) ?? [];
  const hourly: number[] = Array(24).fill(0);
  for (let h = 0; h < 24; h++) hourly[h] = rawHourly[h] ?? 0;
  const hourlyTotal = hourly.reduce((a, b) => a + b, 0);
  if (hourlyTotal > 0) {
    vec[2] = hourly.slice(5, 12).reduce((a, b) => a + b, 0) / hourlyTotal;  // 5–11 am
    vec[3] = hourly.slice(17, 23).reduce((a, b) => a + b, 0) / hourlyTotal; // 5–10 pm
  }

  // [4] Weekend ratio — Sunday (index 0) + Saturday (index 6) share of weekly activity
  const rawDaily = (stats.dailyStats as number[]) ?? [];
  const daily: number[] = Array(7).fill(0);
  for (let d = 0; d < 7; d++) daily[d] = rawDaily[d] ?? 0;
  const dailyTotal = daily.reduce((a, b) => a + b, 0);
  if (dailyTotal > 0) {
    vec[4] = ((daily[0] ?? 0) + (daily[6] ?? 0)) / dailyTotal;
  }

  // [5] Overall conversion rate
  vec[5] = stats.totalDecisions > 0 ? stats.totalConversions / stats.totalDecisions : 0;

  // [6–9] Semantic signals from User.attributes (Hightouch-synced YouVersion properties)
  const attrs = stats.attributes ?? {};
  const num = (key: string): number => {
    const v = attrs[key];
    return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0;
  };
  const str = (key: string): string => {
    const v = attrs[key];
    return typeof v === "string" ? v : "";
  };

  // [6] Recency score — absent means no signal (leave as 0)
  if (attrs["days_since_last_open"] !== undefined && attrs["days_since_last_open"] !== null) {
    vec[6] = 1 - Math.min(1, num("days_since_last_open") / 90);
  }

  // [7] Giving tier
  const giverTier = str("giving_tier").toLowerCase();
  vec[7] = giverTier === "sower" ? 1.0 : giverTier === "giver" ? 0.5 : 0.0;

  // [8] Spiritual depth — mean of five engagement depth signals, each in [0,1]
  const streak  = Math.min(1, num("plan_day_current_month_count") / 31);
  const plan    = Math.log(1 + num("plan_finish_lifetime_count")) / Math.log(501);
  const prayer  = Math.min(1, num("gp_current_month_count") / 30);
  const scripture = Math.min(1, num("gs_current_month_count") / 30);
  const badge   = Math.log(1 + num("badge_lifetime_count")) / Math.log(201);
  vec[8] = (streak + plan + prayer + scripture + badge) / 5;

  // [9] Engagement frequency — log-scaled decisions/week (~4-week window)
  const decisionsPerWeek = stats.totalDecisions / 4;
  vec[9] = decisionsPerWeek > 0 ? Math.log(1 + decisionsPerWeek) / Math.log(1 + 100) : 0;

  return vec;
}

/** Cosine similarity between two vectors of the same length */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export { FEATURE_DIM };
