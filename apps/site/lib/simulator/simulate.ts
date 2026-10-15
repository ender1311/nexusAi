import { ThompsonSampling } from "@engine/thompson-sampling";
import { EpsilonGreedy } from "@engine/epsilon-greedy";
import { LinUCB } from "@engine/linucb";
import { mulberry32 } from "./rng";
import type { AlgorithmId, DayState, DecisionSample, Preset, SimulationResult } from "./types";

const SAMPLES_PER_DAY = 6;
const EPSILON = 0.1;
const LINUCB_ALPHA = 1.0;

/**
 * Runs the real Nexus engine against a simulated audience. The engine draws
 * from Math.random, so the run swaps in a seeded stream and always restores
 * the original — the same technique the P0 characterization tests use.
 */
export function simulate(preset: Preset, algorithm: AlgorithmId, seed: number): SimulationResult {
  if (preset.variants.length === 0) throw new Error("Preset has no variants");
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return { presetId: preset.id, algorithm, seed, days: run(preset, algorithm, rng) };
  } finally {
    Math.random = original;
  }
}

function run(preset: Preset, algorithm: AlgorithmId, rng: () => number): DayState[] {
  const { segments, variants } = preset;
  const dim = segments.length + 1; // bias + one-hot segment
  const thompson = new ThompsonSampling();
  const epsilon = new EpsilonGreedy(EPSILON);
  const linucb = new LinUCB(LINUCB_ALPHA);
  const linucbMean = new LinUCB(0); // score with alpha 0 = θᵀx, the point estimate

  const stats = new Map(variants.map((v) => [v.id, { alpha: 1, beta: 1, tries: 0, wins: 0 }]));
  const linArms = new Map(variants.map((v) => [v.id, linucb.initialArm(dim)]));

  let sends = 0;
  let conversions = 0;
  let holdoutSends = 0;
  let holdoutConversions = 0;
  let regret = 0;
  let userNumber = 0;
  const days: DayState[] = [];

  for (let day = 0; day < preset.days; day++) {
    const sentToday: Record<string, number> = {};
    const bySegment: Record<string, Record<string, number>> = {};
    const samples: DecisionSample[] = [];

    for (let u = 0; u < preset.usersPerDay; u++) {
      userNumber++;
      const segIndex = pickSegment(segments.map((s) => s.share), rng());
      const segment = segments[segIndex]!;
      const x = Array.from({ length: dim }, (_, i) => (i === 0 || i === segIndex + 1 ? 1 : 0));
      const inHoldout = rng() < preset.holdoutShare;

      let variantId: string;
      let explore = false;
      if (inHoldout) {
        variantId = variants[Math.floor(rng() * variants.length)]!.id;
      } else if (algorithm === "linucb") {
        variantId = linucb.select(variants.map((v) => ({ id: v.id, ...linArms.get(v.id)! })), x).variantId;
      } else {
        const arms = variants.map((v) => ({ id: v.id, stats: stats.get(v.id)! }));
        const r = algorithm === "thompson" ? thompson.select(arms) : epsilon.select(arms);
        variantId = r.variantId;
        explore = r.explore;
      }

      const variant = variants.find((v) => v.id === variantId)!;
      const trueRate = variant.rates[segIndex]!;
      const converted = rng() < trueRate ? 1 : 0;

      if (inHoldout) {
        holdoutSends++;
        holdoutConversions += converted;
        continue;
      }

      if (samples.length < SAMPLES_PER_DAY && u % Math.ceil(preset.usersPerDay / SAMPLES_PER_DAY) === 0) {
        samples.push(explain(algorithm, userNumber, segment.id, variantId, explore, stats, linArms, linucb, linucbMean, x));
      }

      sends++;
      conversions += converted;
      sentToday[variantId] = (sentToday[variantId] ?? 0) + 1;
      bySegment[segment.id] ??= {};
      bySegment[segment.id]![variantId] = (bySegment[segment.id]![variantId] ?? 0) + 1;
      regret += Math.max(...variants.map((v) => v.rates[segIndex]!)) - trueRate;

      const s = stats.get(variantId)!;
      s.tries++;
      s.wins += converted;
      if (converted) s.alpha++;
      else s.beta++;
      const arm = linArms.get(variantId)!;
      linArms.set(variantId, linucb.update(arm.aInv, arm.b, x, converted));
    }

    const totalToday = Object.values(sentToday).reduce((a, b) => a + b, 0);
    const trafficShare = Object.fromEntries(variants.map((v) => [v.id, totalToday ? (sentToday[v.id] ?? 0) / totalToday : 0]));
    const topVariantBySegment = Object.fromEntries(
      segments.map((seg) => {
        const counts = bySegment[seg.id] ?? {};
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? variants[0]!.id;
        return [seg.id, top];
      }),
    );
    const cumulativeRate = sends ? conversions / sends : 0;
    const holdoutRate = holdoutSends ? holdoutConversions / holdoutSends : 0;
    days.push({
      day: day + 1,
      trafficShare,
      topVariantBySegment,
      cumulativeSends: sends,
      cumulativeConversions: conversions,
      cumulativeRate,
      holdoutRate,
      liftVsHoldout: holdoutConversions > 0 ? cumulativeRate / holdoutRate - 1 : null,
      cumulativeRegret: regret,
      samples,
    });
  }
  return days;
}

function pickSegment(shares: number[], r: number): number {
  let acc = 0;
  for (let i = 0; i < shares.length; i++) {
    acc += shares[i]!;
    if (r < acc) return i;
  }
  return shares.length - 1;
}

function explain(
  algorithm: AlgorithmId,
  userNumber: number,
  segmentId: string,
  variantId: string,
  explore: boolean,
  stats: Map<string, { alpha: number; beta: number; tries: number; wins: number }>,
  linArms: Map<string, { aInv: number[]; b: number[] }>,
  linucb: LinUCB,
  linucbMean: LinUCB,
  x: number[],
): DecisionSample {
  if (algorithm === "linucb") {
    const arm = linArms.get(variantId)!;
    const mean = linucbMean.score(arm.aInv, arm.b, x);
    const ucb = linucb.score(arm.aInv, arm.b, x);
    return { userNumber, segmentId, variantId, explore: false, estimate: clamp01(mean), uncertainty: Math.max(0, ucb - mean) };
  }
  const s = stats.get(variantId)!;
  if (algorithm === "thompson") {
    const n = s.alpha + s.beta;
    const mean = s.alpha / n;
    const sd = Math.sqrt((s.alpha * s.beta) / (n * n * (n + 1)));
    return { userNumber, segmentId, variantId, explore, estimate: mean, uncertainty: 1.96 * sd };
  }
  return { userNumber, segmentId, variantId, explore, estimate: s.tries ? s.wins / s.tries : 0, uncertainty: 0 };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
