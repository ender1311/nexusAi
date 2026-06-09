import { fieldSqlExpr } from "./compile-sql";

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
