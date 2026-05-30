import { describe, expect, it } from "bun:test";
import {
  STAT_CATALOG,
  isKnownStatKey,
  isStatHidden,
  parseHiddenStats,
  sanitizeHiddenStats,
} from "@/lib/stat-visibility";

describe("stat-visibility catalog", () => {
  it("has unique keys across all groups", () => {
    const keys = STAT_CATALOG.flatMap((g) => g.stats.map((s) => s.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every catalog key is recognised by isKnownStatKey", () => {
    for (const g of STAT_CATALOG) {
      for (const s of g.stats) expect(isKnownStatKey(s.key)).toBe(true);
    }
  });

  it("rejects unknown / non-string values", () => {
    expect(isKnownStatKey("agent.bogus")).toBe(false);
    expect(isKnownStatKey(42)).toBe(false);
    expect(isKnownStatKey(null)).toBe(false);
  });
});

describe("isStatHidden", () => {
  it("is true only when the key is present in the hidden list", () => {
    expect(isStatHidden(["agent.algorithm"], "agent.algorithm")).toBe(true);
    expect(isStatHidden(["agent.algorithm"], "agent.decisions")).toBe(false);
    expect(isStatHidden([], "dashboard.totalSends")).toBe(false);
  });
});

describe("parseHiddenStats", () => {
  it("returns [] for null/empty/garbage", () => {
    expect(parseHiddenStats(null)).toEqual([]);
    expect(parseHiddenStats(undefined)).toEqual([]);
    expect(parseHiddenStats("")).toEqual([]);
    expect(parseHiddenStats("not json")).toEqual([]);
    expect(parseHiddenStats('{"not":"an array"}')).toEqual([]);
  });

  it("keeps only known keys and dedupes", () => {
    const out = parseHiddenStats('["agent.algorithm","agent.algorithm","nope","dashboard.totalSends"]');
    expect(out.sort()).toEqual(["agent.algorithm", "dashboard.totalSends"]);
  });
});

describe("sanitizeHiddenStats", () => {
  it("filters non-arrays to []", () => {
    expect(sanitizeHiddenStats("agent.algorithm")).toEqual([]);
    expect(sanitizeHiddenStats(undefined)).toEqual([]);
  });

  it("filters unknown keys and dedupes", () => {
    expect(sanitizeHiddenStats(["agent.decisions", "x", "agent.decisions"])).toEqual(["agent.decisions"]);
  });
});
