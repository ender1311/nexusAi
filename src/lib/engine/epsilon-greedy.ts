import { ArmStats, BanditArm, DecisionResult } from "./types";

export class EpsilonGreedy {
  constructor(private epsilon: number = 0.1) {}

  select(arms: BanditArm[]): DecisionResult {
    if (arms.length === 0) throw new Error("No arms to select from");

    const explore = Math.random() < this.epsilon;

    if (explore) {
      const arm = arms[Math.floor(Math.random() * arms.length)];
      return {
        variantId: arm.id,
        channel: "",
        explore: true,
        predictedReward: arm.stats.tries > 0 ? arm.stats.wins / arm.stats.tries : 0,
      };
    }

    // Deliver: pick arm with highest empirical reward rate
    let bestArm = arms[0];
    let bestRate = -Infinity;
    for (const arm of arms) {
      const rate = arm.stats.tries > 0 ? arm.stats.wins / arm.stats.tries : 0;
      if (rate > bestRate) {
        bestRate = rate;
        bestArm = arm;
      }
    }

    return {
      variantId: bestArm.id,
      channel: "",
      explore: false,
      predictedReward: bestRate,
    };
  }

  updateArm(stats: ArmStats, reward: number): ArmStats {
    return {
      ...stats,
      tries: stats.tries + 1,
      wins: stats.wins + (reward > 0 ? 1 : 0),
      alpha: stats.alpha + (reward > 0 ? reward : 0),
      beta: stats.beta + (reward <= 0 ? 1 : 0),
    };
  }

  decayEpsilon(minEpsilon = 0.01): void {
    this.epsilon = Math.max(minEpsilon, this.epsilon * 0.995);
  }

  initialStats(): ArmStats {
    return { alpha: 0, beta: 0, tries: 0, wins: 0 };
  }
}
