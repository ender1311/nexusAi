import { describe, expect, it } from "bun:test";
import { INTERACTION_FLAGS, INTERACTION_FLAG_LABELS } from "@/lib/constants/interaction-flags";
import { INTERACTION_GOALS } from "@/lib/constants/youversion";

describe("INTERACTION_GOALS presets", () => {
  it("has exactly one preset per interaction flag (9 total)", () => {
    expect(INTERACTION_GOALS).toHaveLength(9);
  });

  it("eventName matches each INTERACTION_FLAG exactly", () => {
    const eventNames = INTERACTION_GOALS.map((g) => g.eventName);
    for (const flag of INTERACTION_FLAGS) {
      expect(eventNames).toContain(flag);
    }
  });

  it("label matches INTERACTION_FLAG_LABELS for each preset", () => {
    for (const preset of INTERACTION_GOALS) {
      expect(preset.label).toBe(
        INTERACTION_FLAG_LABELS[preset.eventName as keyof typeof INTERACTION_FLAG_LABELS],
      );
    }
  });

  it("all presets have tier 'very_good'", () => {
    for (const preset of INTERACTION_GOALS) {
      expect(preset.tier).toBe("very_good");
    }
  });

  it("all presets have weight 5", () => {
    for (const preset of INTERACTION_GOALS) {
      expect(preset.weight).toBe(5);
    }
  });

  it("all presets have a non-empty description", () => {
    for (const preset of INTERACTION_GOALS) {
      expect(typeof preset.description).toBe("string");
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});
