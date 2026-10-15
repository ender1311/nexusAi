// The stack pickers only relabel the UI. The simulation is a function of
// (preset, algorithm, seed) and nothing else — this pins that contract.
import { describe, expect, it } from "bun:test";
import { simulate } from "@site/lib/simulator/simulate";
import { getPreset } from "@site/lib/simulator/presets";

describe("stack choice does not change results", () => {
  it("simulate has no stack parameter and is stable across calls", () => {
    expect(simulate.length).toBe(3);
    const a = simulate(getPreset("upsell"), "linucb", 4);
    const b = simulate(getPreset("upsell"), "linucb", 4);
    expect(a).toEqual(b);
  });
});
