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
    const r = compileSegmentRule(g("AND", [c("totalDecisions", "gte", 5)]));
    expect(r.sql).toBe(`(u."totalDecisions" >= $1)`);
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
    const r = compileSegmentRule(g("AND", [c("funnelStage", "in", ["wau"]), g("OR", [c("totalDecisions", "gte", 5), c("totalConversions", "gte", 1)])]));
    expect(r.sql).toBe(`(u."funnelStage" = ANY($1) AND (u."totalDecisions" >= $2 OR u."totalConversions" >= $3))`);
    expect(r.params).toEqual([["wau"], 5, 1]);
  });

  it("empty nested group is dropped from its parent", () => {
    const r = compileSegmentRule(g("AND", [c("totalDecisions", "gte", 5), g("OR", [])]));
    expect(r.sql).toBe(`(u."totalDecisions" >= $1)`);
    expect(r.params).toEqual([5]);
  });
});
