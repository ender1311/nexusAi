import { describe, it, expect } from "bun:test";
import type { BanditArm } from "@/lib/engine/types";
import { blendArm } from "@/lib/engine/select-variant";

const personaArm: BanditArm = {
  id: "var_001",
  stats: { alpha: 1, beta: 30, tries: 100, wins: 3 },
};

describe("blendArm — user-level posterior blending", () => {
  it("with no user stats returns persona arm unchanged", () => {
    const result = blendArm(personaArm, undefined);
    expect(result).toBe(personaArm); // same reference
  });

  it("with zero user tries returns persona arm unchanged", () => {
    const result = blendArm(personaArm, { alpha: 1, beta: 30, tries: 0, wins: 0 });
    expect(result).toBe(personaArm);
  });

  it("user wins shift alpha up", () => {
    const userStats = { alpha: 1, beta: 30, tries: 10, wins: 5 };
    const blended = blendArm(personaArm, userStats);
    expect(blended.stats.alpha).toBe(personaArm.stats.alpha + 5);
  });

  it("user losses shift beta up", () => {
    const userStats = { alpha: 1, beta: 30, tries: 10, wins: 2 }; // 8 losses
    const blended = blendArm(personaArm, userStats);
    expect(blended.stats.beta).toBe(personaArm.stats.beta + 8);
  });

  it("blended expected rate is weighted average of persona and user rates", () => {
    // Persona: 3/100 = 3%.  User: 5/10 = 50%.
    // Blended alpha = 1 + 5 = 6, beta = 30 + (10 - 5) = 35. Rate = 6/41 ≈ 14.6%
    const userStats = { alpha: 1, beta: 30, tries: 10, wins: 5 };
    const blended = blendArm(personaArm, userStats);
    const blendedRate = blended.stats.alpha / (blended.stats.alpha + blended.stats.beta);
    expect(blendedRate).toBeCloseTo(6 / 41, 5);
    // Blended rate is higher than persona alone (3/31 ≈ 9.7%)
    const personaRate = personaArm.stats.alpha / (personaArm.stats.alpha + personaArm.stats.beta);
    expect(blendedRate).toBeGreaterThan(personaRate);
  });

  it("blended tries and wins are additive", () => {
    const userStats = { alpha: 1, beta: 30, tries: 20, wins: 4 };
    const blended = blendArm(personaArm, userStats);
    expect(blended.stats.tries).toBe(personaArm.stats.tries + 20);
    expect(blended.stats.wins).toBe(personaArm.stats.wins + 4);
  });

  it("blended arm preserves variant id", () => {
    const userStats = { alpha: 1, beta: 30, tries: 5, wins: 1 };
    const blended = blendArm(personaArm, userStats);
    expect(blended.id).toBe(personaArm.id);
  });

  it("all-zero user data (no interactions yet) returns persona unchanged", () => {
    const userStats = { alpha: 1, beta: 30, tries: 0, wins: 0 };
    const result = blendArm(personaArm, userStats);
    expect(result).toBe(personaArm);
  });
});
