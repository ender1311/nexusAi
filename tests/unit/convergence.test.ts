// Unit tests for the segment-aware convergence model used by the architecture
// page calculator. Guards the throughput math (arms × OBS_PER_ARM × cycleHours
// / segmentSize), the people-explored cap, and the slider snap-to-5 behavior.
import { describe, expect, it } from "bun:test";
import {
  OBS_PER_ARM,
  cycleHours,
  observationsNeeded,
  peopleExplored,
  convergenceHoursForSegment,
  openRateForStage,
  sendsToConverge,
  snapArms,
} from "@/lib/convergence";

describe("cycleHours", () => {
  it("derives one eligibility cycle from sends/month", () => {
    expect(cycleHours("dau4")).toBeCloseTo((30 / 25) * 24, 5); // 28.8h
    expect(cycleHours("lapsed_dau4")).toBeCloseTo((30 / 2) * 24, 5); // 360h
  });

  it("returns null for an empty/undefined stage", () => {
    expect(cycleHours("")).toBeNull();
  });
});

describe("observationsNeeded", () => {
  it("is arms × OBS_PER_ARM", () => {
    expect(observationsNeeded(10)).toBe(10 * OBS_PER_ARM);
    expect(observationsNeeded(3)).toBe(3 * OBS_PER_ARM);
  });
});

describe("openRateForStage", () => {
  it("returns the per-stage base open rate, lower for less-engaged stages", () => {
    expect(openRateForStage("dau4")).toBe(0.05);
    expect(openRateForStage("lapsed_dau4")).toBe(0.01);
    // engagement (and so open rate) monotonically decreases down the funnel
    expect(openRateForStage("dau4")!).toBeGreaterThan(openRateForStage("wau")!);
    expect(openRateForStage("wau")!).toBeGreaterThan(openRateForStage("mau")!);
    expect(openRateForStage("mau")!).toBeGreaterThan(openRateForStage("lapsed_dau4")!);
  });

  it("returns null for an empty stage", () => {
    expect(openRateForStage("")).toBeNull();
  });
});

describe("sendsToConverge", () => {
  it("is arms × OBS_PER_ARM / openRate (low open rate ⇒ far more sends)", () => {
    expect(sendsToConverge("dau4", 10)).toBe(Math.ceil((10 * OBS_PER_ARM) / 0.05)); // 8000
    expect(sendsToConverge("lapsed_dau4", 10)).toBe(Math.ceil((10 * OBS_PER_ARM) / 0.01)); // 40000
  });
});

describe("peopleExplored", () => {
  it("caps at sends-to-converge when the segment is large", () => {
    // dau4: 10 arms / 5% open → 8000 sends needed, segment 25k → 8000
    expect(peopleExplored("dau4", 10, 25_000)).toBe(8_000);
  });

  it("caps at the segment size when the segment is the bottleneck", () => {
    // lapsed: 10 arms / 1% open → 40000 sends needed, segment 500 → 500
    expect(peopleExplored("lapsed_dau4", 10, 500)).toBe(500);
  });
});

describe("convergenceHoursForSegment", () => {
  it("scales as arms × OBS_PER_ARM × cycleHours / (openRate × segmentSize)", () => {
    // dau4: 28.8h cycle, 5% open, 10 arms, 25k segment → 400 × 28.8 / (0.05 × 25000)
    expect(convergenceHoursForSegment("dau4", 10, 25_000)).toBeCloseTo(9.216, 3);
    // lapsed: 360h cycle, 1% open, 10 arms, 5k segment → 400 × 360 / (0.01 × 5000)
    expect(convergenceHoursForSegment("lapsed_dau4", 10, 5_000)).toBeCloseTo(2880, 1);
  });

  it("low-engagement stages converge much slower than engaged ones (same inputs)", () => {
    const dau4 = convergenceHoursForSegment("dau4", 100, 1_000_000)!;
    const lapsed = convergenceHoursForSegment("lapsed_dau4", 100, 1_000_000)!;
    // lapsed is both rarer-eligible and lower open rate → dramatically slower
    expect(lapsed).toBeGreaterThan(dau4);
    expect(lapsed / dau4).toBeGreaterThan(20);
  });

  it("at 1M users, lapsed still takes days — never under 2 hours (regression)", () => {
    // The bug this guards: a naive segment-only model returned < 2h for lapsed at
    // scale, ignoring that lapsed users rarely open the app.
    const lapsed = convergenceHoursForSegment("lapsed_dau4", 100, 1_000_000)!;
    expect(lapsed).toBeGreaterThan(24); // > 1 day, not minutes
  });

  it("slows down as the segment shrinks (inverse-linear in segment size)", () => {
    const big = convergenceHoursForSegment("wau", 20, 1_000_000)!;
    const small = convergenceHoursForSegment("wau", 20, 1_000)!;
    expect(small / big).toBeCloseTo(1000, 0);
  });

  it("returns null for invalid inputs", () => {
    expect(convergenceHoursForSegment("", 10, 25_000)).toBeNull();
    expect(convergenceHoursForSegment("dau4", 0, 25_000)).toBeNull();
    expect(convergenceHoursForSegment("dau4", 10, 0)).toBeNull();
  });
});

describe("snapArms", () => {
  it("snaps to the nearest multiple of 5", () => {
    expect(snapArms(7)).toBe(5);
    expect(snapArms(8)).toBe(10);
    expect(snapArms(12)).toBe(10);
    expect(snapArms(13)).toBe(15);
  });

  it("floors at 5 and ceilings at 10000", () => {
    expect(snapArms(2)).toBe(5);
    expect(snapArms(3)).toBe(5);
    expect(snapArms(99_999)).toBe(10_000);
  });
});
