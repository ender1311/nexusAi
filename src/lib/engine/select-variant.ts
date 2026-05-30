import { ThompsonSampling } from "./thompson-sampling";
import { EpsilonGreedy } from "./epsilon-greedy";
import { LinUCB } from "./linucb";
import type { BanditArm } from "./types";

/** Runtime bandit algorithm stored on `Agent.algorithm`. */
export type Algorithm = "linucb" | "epsilon_greedy" | "thompson";

/** A LinUCB arm's persisted state: inverse design matrix + reward vector. */
export type LinUCBArmState = { id: string; aInv: number[]; b: number[] };

export type SelectVariantInput =
  | {
      algorithm: "linucb";
      linucbArms: LinUCBArmState[];
      context: number[];
    }
  | {
      algorithm: "epsilon_greedy" | "thompson";
      arms: BanditArm[];
      /** Required for epsilon_greedy; ignored by thompson. */
      epsilon?: number;
      /** Per-arm recency multipliers applied by Thompson sampling only. */
      recencyPenalties?: Record<string, number>;
    };

/**
 * Pure variant-selection dispatch shared by `/api/decide` and the cron route.
 *
 * Arm loading, seeding, and per-user blending stay in the IO layer (route handlers);
 * this function only chooses an arm given already-prepared inputs. Returns the selected
 * variant id, or `null` when there are no arms to choose from.
 */
export function selectVariant(input: SelectVariantInput): string | null {
  if (input.algorithm === "linucb") {
    if (input.linucbArms.length === 0) return null;
    return new LinUCB().select(input.linucbArms, input.context).variantId;
  }

  if (input.arms.length === 0) return null;

  if (input.algorithm === "epsilon_greedy") {
    return new EpsilonGreedy(input.epsilon).select(input.arms).variantId;
  }

  return new ThompsonSampling().select(input.arms, input.recencyPenalties).variantId;
}

/**
 * Blend a persona-level Beta prior with a user-specific posterior.
 *
 * Adds the user's observed wins/failures onto the persona arm so a user with personal
 * history pulls the estimate toward their own behavior; with no user history (or zero
 * tries) the persona prior is returned unchanged. Pure — does not mutate inputs.
 */
export function blendArm(
  personaArm: BanditArm,
  userStats: { alpha: number; beta: number; tries: number; wins: number } | undefined,
): BanditArm {
  if (!userStats || userStats.tries === 0) return personaArm;
  return {
    id: personaArm.id,
    stats: {
      alpha: personaArm.stats.alpha + userStats.wins,
      beta: personaArm.stats.beta + (userStats.tries - userStats.wins),
      tries: personaArm.stats.tries + userStats.tries,
      wins: personaArm.stats.wins + userStats.wins,
    },
  };
}
