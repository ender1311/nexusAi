import { describe, expect, it } from "bun:test";
import {
  PUSH_CATEGORIES,
  PUSH_CATEGORY_VALUES,
  PUSH_SUBCATEGORIES,
} from "@/lib/push-categories";

describe("push-categories catalogue", () => {
  it("includes the giving category so giving pushes are reachable everywhere", () => {
    // Regression: template-picker / variant-picker once hardcoded a catalogue that
    // omitted "giving", making the 56 curated giving pushes unselectable into agents.
    expect(PUSH_CATEGORY_VALUES).toContain("giving");
    expect(PUSH_SUBCATEGORIES.giving.length).toBe(10);
    expect(PUSH_SUBCATEGORIES.giving).toContain("dynamic-handle");
  });

  it("derives every helper from the same source so they cannot drift", () => {
    expect(PUSH_CATEGORY_VALUES).toEqual(PUSH_CATEGORIES.map((c) => c.value));
    for (const c of PUSH_CATEGORIES) {
      expect(PUSH_SUBCATEGORIES[c.value]).toEqual(c.subcategories.map((s) => s.value));
    }
  });

  it("matches the canonical DB subcategory mapping", () => {
    expect(PUSH_SUBCATEGORIES["guided-scripture"]).toEqual(["guided-scripture", "votd-dynamic"]);
    expect(PUSH_SUBCATEGORIES.votd).toEqual(["votd-page", "todays-story"]);
  });

  it("has no duplicate category or subcategory values", () => {
    expect(new Set(PUSH_CATEGORY_VALUES).size).toBe(PUSH_CATEGORY_VALUES.length);
    for (const c of PUSH_CATEGORIES) {
      const subs = c.subcategories.map((s) => s.value);
      expect(new Set(subs).size).toBe(subs.length);
    }
  });
});
