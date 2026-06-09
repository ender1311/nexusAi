import { describe, expect, it } from "bun:test";
import { valuesFacetSql, valuesStatsSql, rangeFacetSql } from "@/lib/segments/facet-compute";

describe("facet compute SQL builders", () => {
  it("values SQL for an attribute field uses the JSON expression and orders by count desc", () => {
    const sql = valuesFacetSql("country_latest");
    expect(sql).toContain(`u."attributes"->>'country_latest'`);
    expect(sql).toContain(`FROM "User" u`);
    expect(sql).toContain("GROUP BY 1");
    expect(sql).toContain("ORDER BY c DESC");
    expect(sql).toContain("LIMIT 50");
  });

  it("values stats SQL counts distinct + non-null total", () => {
    const sql = valuesStatsSql("country_latest");
    expect(sql).toContain(`COUNT(DISTINCT u."attributes"->>'country_latest')`);
    expect(sql).toContain(`FILTER (WHERE u."attributes"->>'country_latest' IS NOT NULL)`);
  });

  it("range SQL for a scalar numeric column uses min/max/percentile_disc", () => {
    const sql = rangeFacetSql("totalDecisions");
    expect(sql).toContain(`MIN(u."totalDecisions")`);
    expect(sql).toContain(`MAX(u."totalDecisions")`);
    expect(sql).toContain(`PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY u."totalDecisions")`);
    expect(sql).toContain(`PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY u."totalDecisions")`);
  });

  it("range SQL for a channelStat field casts to numeric", () => {
    const sql = rangeFacetSql("push_sent");
    expect(sql).toContain(`(u."channelStats"->'push'->>'sent')::numeric`);
  });
});
