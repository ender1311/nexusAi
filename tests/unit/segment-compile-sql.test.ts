import { describe, expect, it } from "bun:test";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import type { SegmentRule } from "@/types/segment";

const g = (join: "AND" | "OR", children: unknown[]): SegmentRule => ({ kind: "group", join, children } as SegmentRule);
const c = (fieldId: string, operator: string, value: unknown) => ({ kind: "condition", fieldId, operator, value });

describe("compileSegmentRule", () => {
  it("empty root → TRUE, no params", () => {
    expect(compileSegmentRule(g("AND", []))).toEqual({ sql: "TRUE", params: [] });
  });

  it("scalar comparison uses a bound param", () => {
    const r = compileSegmentRule(g("AND", [c("createdAt", "gte", 5)]));
    expect(r.sql).toBe(`(u."createdAt" >= $1)`);
    expect(r.params).toEqual([5]);
  });

  it("attr numeric cast", () => {
    const r = compileSegmentRule(g("AND", [c("days_since_last_open", "lt", 7)]));
    expect(r.sql).toBe(`((u."attributes"->>'days_since_last_open')::numeric < $1)`);
    expect(r.params).toEqual([7]);
  });

  it("attr boolean is_true uses no value param", () => {
    const r = compileSegmentRule(g("AND", [c("has_recurring_gift", "is_true", null)]));
    expect(r.sql).toBe(`((u."attributes"->>'has_recurring_gift')::boolean = true)`);
    expect(r.params).toEqual([]);
  });

  it("interaction-flag boolean wraps in COALESCE so absent counts as false", () => {
    const r = compileSegmentRule(g("AND", [c("votd_interaction_has_ever_flag", "is_false", null)]));
    expect(r.sql).toBe(
      `(COALESCE((u."attributes"->>'votd_interaction_has_ever_flag')::boolean, false) = false)`,
    );
    expect(r.params).toEqual([]);
  });

  it("interaction-flag is_true also goes through COALESCE", () => {
    const r = compileSegmentRule(g("AND", [c("plan_interaction_has_ever_flag", "is_true", null)]));
    expect(r.sql).toBe(
      `(COALESCE((u."attributes"->>'plan_interaction_has_ever_flag')::boolean, false) = true)`,
    );
    expect(r.params).toEqual([]);
  });

  it("plain boolean fields (no absentFalse) keep their exact pre-existing SQL shape", () => {
    const r = compileSegmentRule(g("AND", [c("has_recurring_gift", "is_false", null)]));
    expect(r.sql).toBe(`((u."attributes"->>'has_recurring_gift')::boolean = false)`);
    expect(r.params).toEqual([]);
  });

  it("attr exists uses the ? operator", () => {
    const r = compileSegmentRule(g("AND", [c("email", "exists", null)]));
    expect(r.sql).toBe(`(u."attributes" ? 'email')`);
    expect(r.params).toEqual([]);
  });

  it("in expands to = ANY with a single array param", () => {
    const r = compileSegmentRule(g("AND", [c("funnelStage", "in", ["wau", "mau"])]));
    expect(r.sql).toBe(`(u."funnelStage" = ANY($1))`);
    expect(r.params).toEqual([["wau", "mau"]]);
  });

  it("contains wraps the value in wildcards (value, not SQL)", () => {
    const r = compileSegmentRule(g("AND", [c("email", "contains", "gmail")]));
    expect(r.sql).toBe(`(u."attributes"->>'email' ILIKE $1)`);
    expect(r.params).toEqual(["%gmail%"]);
  });

  it("channelStat numeric path", () => {
    const r = compileSegmentRule(g("AND", [c("push_sent", "gt", 0)]));
    expect(r.sql).toBe(`((u."channelStats"->'push'->>'sent')::numeric > $1)`);
    expect(r.params).toEqual([0]);
  });

  it("segment membership compiles to EXISTS", () => {
    const r = compileSegmentRule(g("AND", [c("segment_membership", "in_segment", "all-givers")]));
    expect(r.sql).toBe(`(EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" = u."externalId" AND us."segmentName" = $1))`);
    expect(r.params).toEqual(["all-givers"]);
  });

  it("not_in_segment compiles to NOT EXISTS", () => {
    const r = compileSegmentRule(g("AND", [c("segment_membership", "not_in_segment", "all-givers")]));
    expect(r.sql).toContain("NOT EXISTS");
  });

  it("nested groups parenthesize and number params left-to-right", () => {
    const r = compileSegmentRule(g("AND", [c("funnelStage", "in", ["wau"]), g("OR", [c("createdAt", "gte", 5), c("gift_count_lifetime", "gte", 1)])]));
    expect(r.sql).toBe(`(u."funnelStage" = ANY($1) AND (u."createdAt" >= $2 OR (u."attributes"->>'gift_count_lifetime')::numeric >= $3))`);
    expect(r.params).toEqual([["wau"], 5, 1]);
  });

  it("empty nested group is dropped from its parent", () => {
    const r = compileSegmentRule(g("AND", [c("createdAt", "gte", 5), g("OR", [])]));
    expect(r.sql).toBe(`(u."createdAt" >= $1)`);
    expect(r.params).toEqual([5]);
  });

  // Defense-in-depth: compileSegmentRule is exported and may be called with a
  // forged rule that bypassed the parser. Catalog/join identifiers must never
  // be interpolated from un-validated input.
  it("throws on an unknown field (forged rule that skipped the parser)", () => {
    expect(() => compileSegmentRule(g("AND", [c("evil); DROP", "eq", 1)]))).toThrow(/Unknown segment field/);
  });

  it("throws on an illegal join keyword", () => {
    const forged = { kind: "group", join: "AND) OR (1=1", children: [c("createdAt", "gte", 5)] } as unknown as SegmentRule;
    expect(() => compileSegmentRule(forged)).toThrow(/Illegal segment join/);
  });

  // Audit fix #7: an independent compile-time depth guard so a forged rule that
  // skipped the parser's MAX_RULE_DEPTH can't drive unbounded recursion here.
  it("throws when nesting exceeds the compile depth guard", () => {
    let node: unknown = c("funnelStage", "in", ["wau"]);
    for (let i = 0; i < 25; i++) node = { kind: "group", join: "AND", children: [node] };
    expect(() => compileSegmentRule(node as SegmentRule)).toThrow(/nesting exceeds/);
  });

  it("compiles a rule nested within the depth guard", () => {
    let node: unknown = c("funnelStage", "in", ["wau"]);
    for (let i = 0; i < 5; i++) node = { kind: "group", join: "AND", children: [node] };
    expect(() => compileSegmentRule(node as SegmentRule)).not.toThrow();
  });
});
