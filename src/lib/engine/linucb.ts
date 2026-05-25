import { FEATURE_DIM } from "./feature-vector";

/**
 * LinUCB (Linear Upper Confidence Bound) contextual bandit.
 *
 * Each arm maintains:
 *   A^{-1} — inverse of the design matrix (d×d, stored flattened row-major)
 *   b       — accumulated reward vector (d floats)
 *
 * Decision rule: θ = A^{-1} b; score = θᵀx + α√(xᵀA^{-1}x)
 *   - The first term exploits the estimated linear reward model
 *   - The second term explores arms with high uncertainty for context x
 *
 * Update (Sherman-Morrison rank-1 inverse update):
 *   A^{-1}_new = A^{-1} − (A^{-1}x)(A^{-1}x)ᵀ / (1 + xᵀA^{-1}x)
 *   b_new      = b + reward · x
 *
 * Reference: Chu et al. (2011) "Contextual Bandits with Linear Payoff Functions"
 */
export class LinUCB {
  /** Exploration coefficient — higher = more uncertainty bonus */
  constructor(private readonly alpha: number = 1.0) {}

  /** UCB score for one arm given context x */
  score(aInv: number[], b: number[], x: number[]): number {
    const d = x.length;
    const theta = matVec(aInv, b, d);
    const exploit = dot(theta, x);
    const aInvX = matVec(aInv, x, d);
    const uncertainty = Math.sqrt(Math.max(0, dot(x, aInvX)));
    const score = exploit + this.alpha * uncertainty;
    if (!isFinite(score)) return 0;
    return score;
  }

  /**
   * Select the best arm given the user's context vector.
   * Ties (within epsilon 1e-10) are broken uniformly at random for exploration.
   */
  select(
    arms: Array<{ id: string; aInv: number[]; b: number[] }>,
    context: number[],
  ): { variantId: string } {
    if (arms.length === 0) throw new Error("LinUCB: no arms to select from");

    // First pass: score all arms once and cache results
    const scores = new Map<string, number>();
    let bestScore = -Infinity;
    for (const arm of arms) {
      const s = this.score(arm.aInv, arm.b, context);
      scores.set(arm.id, s);
      if (s > bestScore) {
        bestScore = s;
      }
    }

    // Collect all arms tied at bestScore (within epsilon tolerance)
    const tied: Array<{ id: string; aInv: number[]; b: number[] }> = [];
    for (const arm of arms) {
      const s = scores.get(arm.id);
      if (s !== undefined && Math.abs(s - bestScore) < 1e-10) {
        tied.push(arm);
      }
    }

    // Guard: if all arms produced non-finite scores, fall back to first arm
    if (tied.length === 0) {
      return { variantId: arms[0]!.id };
    }

    // Return one arm chosen uniformly at random from tied arms
    const selected = tied[Math.floor(Math.random() * tied.length)]!;
    return { variantId: selected.id };
  }

  /**
   * Sherman-Morrison rank-1 update for A^{-1} after observing (context x, reward r).
   * Returns new {aInv, b} — does not mutate inputs.
   */
  update(
    aInv: number[],
    b: number[],
    x: number[],
    reward: number,
  ): { aInv: number[]; b: number[] } {
    const d = x.length;
    const aInvX = matVec(aInv, x, d);
    const denom = 1 + dot(x, aInvX);
    if (Math.abs(denom) < 1e-10) return { aInv, b }; // skip update to avoid numerical instability

    const newAInv = aInv.slice();
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        newAInv[i * d + j] -= (aInvX[i]! * aInvX[j]!) / denom;
      }
    }

    const newB = b.map((bi, i) => bi + reward * x[i]!);
    return { aInv: newAInv, b: newB };
  }

  /**
   * Initial arm state: A = I (identity prior — no prior information), b = 0.
   */
  initialArm(dim: number = FEATURE_DIM): { aInv: number[]; b: number[] } {
    const aInv = new Array<number>(dim * dim).fill(0);
    for (let i = 0; i < dim; i++) aInv[i * dim + i] = 1;
    const b = new Array<number>(dim).fill(0);
    return { aInv, b };
  }
}

/** Dot product of two equal-length vectors */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** Matrix × vector multiply: mat is d×d flattened row-major, vec is d-element */
function matVec(mat: number[], vec: number[], d: number): number[] {
  const result = new Array<number>(d).fill(0);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      result[i]! += mat[i * d + j]! * vec[j]!;
    }
  }
  return result;
}
