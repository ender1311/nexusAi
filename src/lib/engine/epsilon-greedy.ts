import { BanditArm, DecisionResult } from "./types";

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
}
