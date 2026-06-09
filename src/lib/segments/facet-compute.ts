import { fieldSqlExpr } from "./compile-sql";
import { prisma } from "@/lib/db";
import type { FieldDef } from "./field-catalog";
import type { FieldFacet, ValueCount } from "./facet-types";

const TOP_LIMIT = 50;

export function valuesFacetSql(fieldId: string): string {
  const { expr } = fieldSqlExpr(fieldId);
  return `SELECT ${expr} AS v, COUNT(*)::bigint AS c FROM "User" u WHERE ${expr} IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT ${TOP_LIMIT}`;
}

export function valuesStatsSql(fieldId: string): string {
  const { expr } = fieldSqlExpr(fieldId);
  return `SELECT COUNT(DISTINCT ${expr})::bigint AS distinct_approx, COUNT(*) FILTER (WHERE ${expr} IS NOT NULL)::bigint AS total FROM "User" u`;
}

export function rangeFacetSql(fieldId: string): string {
  const { expr } = fieldSqlExpr(fieldId);
  // PERCENTILE_DISC works for both numeric and timestamp columns (returns an actual
  // data point), so one builder covers numeric and date range fields.
  return `SELECT MIN(${expr}) AS min, MAX(${expr}) AS max, ` +
    `PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY ${expr}) AS p50, ` +
    `PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY ${expr}) AS p90 ` +
    `FROM "User" u WHERE ${expr} IS NOT NULL`;
}

const COMPUTE_TIMEOUT_MS = 60_000;

/** Runs the right aggregation for a field's facet kind and assembles the payload. */
export async function computeFieldFacet(field: FieldDef): Promise<FieldFacet> {
  if (!field.facet) throw new Error(`Field ${field.id} has no facet`);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${COMPUTE_TIMEOUT_MS}`);

    if (field.facet!.kind === "values") {
      const topRows = await tx.$queryRawUnsafe<Array<{ v: string | null; c: bigint }>>(valuesFacetSql(field.id));
      const statRows = await tx.$queryRawUnsafe<Array<{ distinct_approx: bigint; total: bigint }>>(valuesStatsSql(field.id));
      const top: ValueCount[] = topRows
        .filter((r): r is { v: string; c: bigint } => r.v !== null)
        .map((r) => ({ value: r.v, count: Number(r.c) }));
      return {
        kind: "values",
        payload: {
          top,
          distinctApprox: Number(statRows[0]?.distinct_approx ?? BigInt(0)),
          total: Number(statRows[0]?.total ?? BigInt(0)),
        },
      };
    }

    // range
    const rows = await tx.$queryRawUnsafe<Array<{ min: unknown; max: unknown; p50: unknown; p90: unknown }>>(rangeFacetSql(field.id));
    const r = rows[0] ?? { min: 0, max: 0, p50: 0, p90: 0 };
    const ser = (v: unknown): number | string =>
      v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : String(v ?? "");
    return { kind: "range", payload: { min: ser(r.min), max: ser(r.max), p50: ser(r.p50), p90: ser(r.p90) } };
  }, { timeout: COMPUTE_TIMEOUT_MS + 1_000 });
}
