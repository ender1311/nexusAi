import { describe, it, expect } from "bun:test";
import {
  classifyConvergence,
  computeVariantDistribution,
} from "@/lib/agent-sends/convergence-state";

describe("classifyConvergence", () => {
  it("is exploring when total < 20 regardless of share", () => {
    expect(classifyConvergence(10, 0.99)).toBe("exploring");
  });

  it("is exploring when top share < 35%", () => {
    expect(classifyConvergence(100, 0.34)).toBe("exploring");
  });

  it("is learning between 35% and 50%", () => {
    expect(classifyConvergence(100, 0.35)).toBe("learning");
    expect(classifyConvergence(100, 0.49)).toBe("learning");
  });

  it("is converging between 50% and 70%", () => {
    expect(classifyConvergence(100, 0.5)).toBe("converging");
    expect(classifyConvergence(100, 0.69)).toBe("converging");
  });

  it("is confident at 70% or above", () => {
    expect(classifyConvergence(100, 0.7)).toBe("confident");
    expect(classifyConvergence(100, 1)).toBe("confident");
  });
});

describe("computeVariantDistribution", () => {
  function rows(spec: Array<{ variantId: string; name: string; n: number; conv?: number }>) {
    const out = [];
    for (const s of spec) {
      for (let i = 0; i < s.n; i++) {
        out.push({
          variantId: s.variantId,
          variantName: s.name,
          reward: i < (s.conv ?? 0) ? 1 : null,
        });
      }
    }
    return out;
  }

  it("tallies counts and conversions per variant, sorted by count desc", () => {
    const dist = computeVariantDistribution(
      rows([
        { variantId: "a", name: "A", n: 30, conv: 6 },
        { variantId: "b", name: "B", n: 10, conv: 1 },
      ]),
    );
    expect(dist.total).toBe(40);
    expect(dist.entries.map((e) => e.name)).toEqual(["A", "B"]);
    expect(dist.entries[0]).toEqual({ name: "A", count: 30, conversions: 6 });
    expect(dist.topShare).toBeCloseTo(0.75, 5);
    expect(dist.state).toBe("confident");
  });

  it("ignores rows with neither variantId nor variantName", () => {
    const dist = computeVariantDistribution([
      { variantId: null, variantName: null, reward: 1 },
      { variantId: "a", variantName: "A", reward: null },
    ]);
    expect(dist.total).toBe(1);
    expect(dist.entries).toHaveLength(1);
  });

  it("returns a zeroed distribution for empty input", () => {
    const dist = computeVariantDistribution([]);
    expect(dist.total).toBe(0);
    expect(dist.topShare).toBe(0);
    expect(dist.state).toBe("exploring");
  });

  it("only counts reward > 0 as a conversion", () => {
    const dist = computeVariantDistribution([
      { variantId: "a", variantName: "A", reward: 0 },
      { variantId: "a", variantName: "A", reward: -1 },
      { variantId: "a", variantName: "A", reward: 2 },
    ]);
    expect(dist.entries[0].conversions).toBe(1);
  });
});
