import { ArmStats, BanditArm, DecisionResult } from "./types";

/**
 * Thompson Sampling using Beta distribution.
 * Each arm has alpha (successes) and beta (failures) params.
 * We sample from Beta(alpha, beta) for each arm and pick the highest sample.
 * This naturally balances exploration (uncertain arms) vs delivery (proven arms).
 */
export class ThompsonSampling {
  /**
   * Sample from Beta(alpha, beta) using the Johnk method approximation.
   * True Beta sampling would require a math library; this is a good approximation.
   */
  private sampleBeta(alpha: number, beta: number): number {
    // Johnk's method: use gamma distribution approximation via the log method
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    return x / (x + y);
  }

  /**
   * Sample from Gamma(shape, 1) using Marsaglia-Tsang method.
   */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      return this.sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x: number, v: number;
      do {
        x = this.randomNormal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  private randomNormal(): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  select(arms: BanditArm[]): DecisionResult {
    if (arms.length === 0) throw new Error("No arms to select from");

    let bestArm = arms[0];
    let bestSample = -Infinity;
    const samples = arms.map((arm) => ({
      arm,
      sample: this.sampleBeta(arm.stats.alpha, arm.stats.beta),
    }));

    for (const { arm, sample } of samples) {
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arm;
      }
    }

    // Determine if this was exploration: if a non-greedy arm was chosen
    const maxTriesArm = arms.reduce((a, b) => (a.stats.tries > b.stats.tries ? a : b));
    const isExplore = bestArm.id !== maxTriesArm.id;

    return {
      variantId: bestArm.id,
      channel: "",
      explore: isExplore,
      predictedReward: bestSample,
    };
  }

  updateArm(stats: ArmStats, reward: number): ArmStats {
    return {
      ...stats,
      alpha: stats.alpha + (reward > 0 ? reward : 0),
      beta: stats.beta + (reward <= 0 ? 1 : 0),
      tries: stats.tries + 1,
      wins: stats.wins + (reward > 0 ? 1 : 0),
    };
  }

  initialStats(): ArmStats {
    return { alpha: 1, beta: 1, tries: 0, wins: 0 };
  }
}
