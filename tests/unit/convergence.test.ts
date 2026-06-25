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

describe("peopleExplored", () => {
  it("caps at the exploration budget when the segment is large", () => {
    expect(peopleExplored(10, 25_000)).toBe(400); // min(25000, 400)
  });

  it("caps at the segment size when the segment is the bottleneck", () => {
    expect(peopleExplored(10, 100)).toBe(100); // min(100, 400)
  });
});

describe("convergenceHoursForSegment", () => {
  it("scales as arms × OBS_PER_ARM × cycleHours / segmentSize", () => {
    // dau4: 28.8h cycle, 10 arms, 25k segment → 400 × 28.8 / 25000
    expect(convergenceHoursForSegment("dau4", 10, 25_000)).toBeCloseTo(0.4608, 4);
    // lapsed: 360h cycle, 10 arms, 5k segment → 400 × 360 / 5000 = 28.8h
    expect(convergenceHoursForSegment("lapsed_dau4", 10, 5_000)).toBeCloseTo(28.8, 4);
  });

  it("slows down as the segment shrinks (small segment = bottleneck)", () => {
    const big = convergenceHoursForSegment("wau", 20, 1_000_000)!;
    const small = convergenceHoursForSegment("wau", 20, 1_000)!;
    expect(small).toBeGreaterThan(big);
    expect(small / big).toBeCloseTo(1000, 0); // inverse-linear in segment size
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
