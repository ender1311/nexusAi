import { describe, expect, it } from "bun:test";
import { valuesFacetSql, valuesStatsSql, rangeFacetSql, samplePct } from "@/lib/segments/facet-compute";

describe("samplePct", () => {
  it("returns 100 (full scan) for small or unknown tables", () => {
    expect(samplePct(0)).toBe(100);
    expect(samplePct(-1)).toBe(100);
    expect(samplePct(100_000)).toBe(100); // at the target → still exact
    expect(samplePct(50_000)).toBe(100);
    expect(samplePct(Number.NaN)).toBe(100);
  });

  it("scales down to a fractional percentage to draw ~100k rows from a large table", () => {
    // 34.75M rows → 100k / 34.75M * 100 ≈ 0.2878%
    expect(samplePct(34_750_652)).toBeCloseTo(0.2878, 4);
  });

  it("clamps to the (0, 100] range", () => {
    expect(samplePct(Number.POSITIVE_INFINITY)).toBe(100); // not finite → full scan
    expect(samplePct(5_000_000_000)).toBe(0.01); // would round to 0.002 → floored at 0.01
  });
});

describe("facet compute SQL builders (sampled)", () => {
  it("values SQL wraps the JSON expression in a sampled subquery and orders by count desc", () => {
    const sql = valuesFacetSql("country_latest", 2);
    expect(sql).toContain(`u."attributes"->>'country_latest' AS v`);
    expect(sql).toContain(`FROM "User" u TABLESAMPLE SYSTEM (2)`);
    expect(sql).toContain("SELECT v, COUNT(*)::bigint AS c");
    expect(sql).toContain("WHERE v IS NOT NULL");
    expect(sql).toContain("GROUP BY 1");
    expect(sql).toContain("ORDER BY c DESC");
    expect(sql).toContain("LIMIT 50");
  });

  it("omits TABLESAMPLE for a full scan (pct = 100) so small tables stay exact", () => {
    const sql = valuesFacetSql("country_latest", 100);
    expect(sql).toContain(`u."attributes"->>'country_latest' AS v`);
    expect(sql).toContain(`FROM "User" u`);
    expect(sql).not.toContain("TABLESAMPLE");
  });

  it("values stats SQL counts distinct + non-null total over the sampled column", () => {
    const sql = valuesStatsSql("country_latest", 2);
    expect(sql).toContain("COUNT(DISTINCT v)::bigint AS distinct_approx");
    expect(sql).toContain("COUNT(v)::bigint AS total");
    expect(sql).toContain(`u."attributes"->>'country_latest' AS v`);
    expect(sql).toContain("TABLESAMPLE SYSTEM (2)");
  });

  it("range SQL for a scalar numeric column uses min/max/percentile_disc over v", () => {
    const sql = rangeFacetSql("createdAt", 2);
    expect(sql).toContain(`u."createdAt" AS v`);
    expect(sql).toContain("MIN(v)");
    expect(sql).toContain("MAX(v)");
    expect(sql).toContain("PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY v)");
    expect(sql).toContain("PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY v)");
    expect(sql).toContain("WHERE v IS NOT NULL");
  });

  it("range SQL for a channelStat field casts to numeric inside the subquery", () => {
    const sql = rangeFacetSql("push_sent", 2);
    expect(sql).toContain(`(u."channelStats"->'push'->>'sent')::numeric AS v`);
  });
});
