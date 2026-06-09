import { describe, expect, it } from "bun:test";
import {
  INTERACTION_FLAGS,
  isInteractionFlag,
  normalizeFlag,
} from "@/lib/constants/interaction-flags";

describe("interaction flags", () => {
  it("lists exactly the 9 has_ever flags", () => {
    expect(INTERACTION_FLAGS).toHaveLength(9);
    expect(INTERACTION_FLAGS).toContain("plan_interaction_has_ever_flag");
    expect(INTERACTION_FLAGS.every((f) => f.endsWith("_flag"))).toBe(true);
  });
  it("recognizes a flag name", () => {
    expect(isInteractionFlag("votd_share_has_ever_flag")).toBe(true);
    expect(isInteractionFlag("not_a_flag")).toBe(false);
  });
  it("normalizes truthy variants Hightouch may send", () => {
    expect(normalizeFlag(true)).toBe(true);
    expect(normalizeFlag("true")).toBe(true);
    expect(normalizeFlag(1)).toBe(true);
    expect(normalizeFlag(false)).toBe(false);
    expect(normalizeFlag("false")).toBe(false);
    expect(normalizeFlag(0)).toBe(false);
    expect(normalizeFlag(null)).toBe(false);
    expect(normalizeFlag(undefined)).toBe(false);
  });
});
