import type { DecisionResult, LinUCBArm, LinUCBStats } from "./types";
import { FEATURE_DIM } from "./feature-vector";

/**
 * LinUCB (Linear Upper Confidence Bound) contextual bandit.
 *
 * Each arm maintains:
 *   A_inv — inverse of (λI + Σ x_t x_t^T), updated via Sherman-Morrison
 *   b     — Σ r_t x_t  (accumulated reward-weighted feature sum)
 *
 * At select time, the expected reward and UCB bonus are:
 *   θ   = A_inv · b                           (ridge regression weights)
 *   UCB = θ · x + alpha * sqrt(x · A_inv · x) (predicted reward + exploration bonus)
 *
 * References:
 *   Li et al. 2010 — "A Contextual-Bandit Approach to Personalized News Article Recommendation"
 *   Deezer 2021 — "A Contextual-Bandit Approach for Music Playlist Continuation" (warm-start)
 */
export class LinUCB {
  constructor(
    /** UCB exploration coefficient — higher → more exploration */
    private readonly alpha: number = 1.0,
    /** Ridge regularization — initializes A_inv = (1/lambda)*I */
    private readonly lambda: number = 1.0,
    /** Feature dimension (default: FEATURE_DIM from feature-vector.ts) */
    private readonly d: number = FEATURE_DIM,
  ) {}

  /** Initialize arm stats: A_inv = (1/lambda)*I, b = 0 */
  initialStats(): LinUCBStats {
    const aInv = new Array<number>(this.d * this.d).fill(0);
    for (let i = 0; i < this.d; i++) {
      aInv[i * this.d + i] = 1 / this.lambda;
    }
    return { aInv, b: new Array<number>(this.d).fill(0), tries: 0 };
  }

  /** Select the arm with highest UCB score given the current user feature vector. */
  select(arms: LinUCBArm[], context: number[]): DecisionResult {
    if (arms.length === 0) throw new Error("No arms to select from");

    const x = context.length === this.d ? context : this.padOrTrunc(context);

    let bestArm = arms[0];
    let bestScore = -Infinity;

    for (const arm of arms) {
      const score = this.ucbScore(arm.linucbStats, x);
      if (score > bestScore) {
        bestScore = score;
        bestArm = arm;
      }
    }

    // An arm with fewer tries than the max is the "explore" arm
    const maxTries = Math.max(...arms.map((a) => a.linucbStats.tries));
    const isExplore = bestArm.linucbStats.tries < maxTries;

    return {
      variantId: bestArm.id,
      channel: "",
      explore: isExplore,
      predictedReward: bestScore,
    };
  }

  /**
   * Update arm stats after observing reward r for context x.
   * Uses Sherman-Morrison rank-1 update: A_inv' = A_inv - (A_inv x x^T A_inv) / (1 + x^T A_inv x)
   */
  update(stats: LinUCBStats, context: number[], reward: number): LinUCBStats {
    const x = context.length === this.d ? context : this.padOrTrunc(context);
    const { aInv, b } = stats;

    // u = A_inv · x
    const u = this.matVec(aInv, x);
    // denom = 1 + x · u
    const denom = 1 + this.dot(x, u);

    // A_inv' = A_inv - (u ⊗ u) / denom   (since u = A_inv x, so u ⊗ x^T A_inv = u ⊗ u^T)
    const newAInv = aInv.slice();
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) {
        newAInv[i * this.d + j] -= (u[i] * u[j]) / denom;
      }
    }

    // b' = b + r * x
    const newB = b.map((bv, i) => bv + reward * x[i]);

    return { aInv: newAInv, b: newB, tries: stats.tries + 1 };
  }

  // --- private helpers ---

  private ucbScore(stats: LinUCBStats, x: number[]): number {
    const { aInv, b } = stats;
    // θ = A_inv · b
    const theta = this.matVec(aInv, b);
    // A_inv · x
    const aInvX = this.matVec(aInv, x);
    // UCB = θ·x + alpha * sqrt(x · A_inv · x)
    const expectedReward = this.dot(theta, x);
    const uncertainty = Math.sqrt(Math.max(0, this.dot(x, aInvX)));
    return expectedReward + this.alpha * uncertainty;
  }

  /** Matrix-vector product: (d×d) × (d) → (d) */
  private matVec(mat: number[], vec: number[]): number[] {
    const result = new Array<number>(this.d).fill(0);
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) {
        result[i] += mat[i * this.d + j] * vec[j];
      }
    }
    return result;
  }

  private dot(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < this.d; i++) s += a[i] * b[i];
    return s;
  }

  /** Pad with zeros or truncate to match feature dimension */
  private padOrTrunc(vec: number[]): number[] {
    if (vec.length === this.d) return vec;
    const out = new Array<number>(this.d).fill(0);
    for (let i = 0; i < Math.min(vec.length, this.d); i++) out[i] = vec[i];
    return out;
  }
}
