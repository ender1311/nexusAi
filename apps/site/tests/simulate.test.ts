import { describe, expect, it } from "bun:test";
import { simulate } from "@site/lib/simulator/simulate";
import { getPreset, PRESETS } from "@site/lib/simulator/presets";
import type { Preset } from "@site/lib/simulator/types";

const SEEDS = [1, 2, 3];

describe("simulate", () => {
  it("is deterministic for the same preset, algorithm and seed", () => {
    const p = getPreset("winback");
    expect(JSON.stringify(simulate(p, "thompson", 7))).toBe(JSON.stringify(simulate(p, "thompson", 7)));
  });

  it("produces one DayState per simulated day", () => {
    for (const p of PRESETS) expect(simulate(p, "thompson", 1).days).toHaveLength(p.days);
  });

  it("Thompson sends most final-day traffic to the true best variant on every single-segment preset", () => {
    for (const id of ["winback", "onboarding"]) {
      const p = getPreset(id);
      const best = p.variants.reduce((a, b) => (b.rates[0]! > a.rates[0]! ? b : a));
      for (const seed of SEEDS) {
        const last = simulate(p, "thompson", seed).days.at(-1)!;
        expect(last.trafficShare[best.id]!).toBeGreaterThan(0.6);
      }
    }
  });

  it("LinUCB beats Thompson on the segmented preset", () => {
    const p = getPreset("upsell");
    for (const seed of SEEDS) {
      const lin = simulate(p, "linucb", seed).days.at(-1)!;
      const ts = simulate(p, "thompson", seed).days.at(-1)!;
      expect(lin.cumulativeRate).toBeGreaterThan(ts.cumulativeRate * 1.2);
      expect(lin.cumulativeRegret).toBeLessThan(ts.cumulativeRegret);
    }
  });

  it("reports positive lift vs the holdout for Thompson on winback", () => {
    const lift = simulate(getPreset("winback"), "thompson", 1).days.at(-1)!.liftVsHoldout;
    expect(lift).not.toBeNull();
    expect(lift!).toBeGreaterThan(0.05);
    expect(lift!).toBeLessThan(2);
  });

  it("reports lift as null on every day when there is no holdout", () => {
    const p: Preset = { ...getPreset("winback"), holdoutShare: 0 };
    for (const day of simulate(p, "thompson", 1).days) expect(day.liftVsHoldout).toBeNull();
  });

  it("passes Thompson's explore flag through to samples", () => {
    const samples = simulate(getPreset("winback"), "thompson", 1).days.flatMap((d) => d.samples);
    expect(samples.some((s) => s.explore)).toBe(true);
    expect(samples.some((s) => !s.explore)).toBe(true);
  });

  it("restores Math.random afterwards, including when the run throws", () => {
    const original = Math.random;
    simulate(getPreset("winback"), "epsilon", 1);
    expect(Math.random).toBe(original);
    const broken: Preset = { ...getPreset("winback"), variants: [] };
    expect(() => simulate(broken, "thompson", 1)).toThrow();
    expect(Math.random).toBe(original);
  });

  it("emits decision samples with an explanation for every algorithm", () => {
    for (const alg of ["thompson", "epsilon", "linucb"] as const) {
      const s = simulate(getPreset("upsell"), alg, 2).days[5]!.samples;
      expect(s.length).toBeGreaterThan(0);
      expect(s[0]!.estimate).toBeGreaterThanOrEqual(0);
      expect(typeof s[0]!.variantId).toBe("string");
    }
  });
});
