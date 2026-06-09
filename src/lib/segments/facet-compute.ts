import { fieldSqlExpr } from "./compile-sql";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { FieldDef } from "./field-catalog";
import type { FieldFacet, ValueCount } from "./facet-types";

const TOP_LIMIT = 50;

// The User table holds tens of millions of rows, and the categorical facet fields
// live in an unindexed JSON column — a full-table GROUP BY / COUNT(DISTINCT) blows
// past the cron's time budget. So we draw a page-level sample (TABLESAMPLE SYSTEM)
// of roughly this many rows and scale the counts back up. Tables at or below this
// size are scanned in full (pct = 100, scale = 1), so results stay exact for small
// datasets and integration tests.
const SAMPLE_TARGET_ROWS = 500_000;

const COMPUTE_TIMEOUT_MS = 60_000;

/** Sample percentage (1–100) needed to draw ~SAMPLE_TARGET_ROWS from a table of estRows. */
export function samplePct(estRows: number): number {
  if (!Number.isFinite(estRows) || estRows <= SAMPLE_TARGET_ROWS) return 100;
  return Math.min(100, Math.max(1, Math.ceil((SAMPLE_TARGET_ROWS / estRows) * 100)));
}

// At pct >= 100 we omit TABLESAMPLE and scan the whole table, so small tables (and
// tests) stay exact. Selecting the field expression into a single column `v` lets
// the outer aggregation stay identical for sampled and full scans.
function sampledFrom(expr: string, pct: number): string {
  const sample = pct >= 100 ? "" : ` TABLESAMPLE SYSTEM (${pct})`;
  return `(SELECT ${expr} AS v FROM "User" u${sample}) s`;
}

export function valuesFacetSql(fieldId: string, pct: number): string {
  const { expr } = fieldSqlExpr(fieldId);
  return `SELECT v, COUNT(*)::bigint AS c FROM ${sampledFrom(expr, pct)} WHERE v IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT ${TOP_LIMIT}`;
}

export function valuesStatsSql(fieldId: string, pct: number): string {
  const { expr } = fieldSqlExpr(fieldId);
  return `SELECT COUNT(DISTINCT v)::bigint AS distinct_approx, COUNT(v)::bigint AS total FROM ${sampledFrom(expr, pct)}`;
}

export function rangeFacetSql(fieldId: string, pct: number): string {
  const { expr } = fieldSqlExpr(fieldId);
  // PERCENTILE_DISC works for both numeric and timestamp columns (returns an actual
  // data point), so one builder covers numeric and date range fields.
  return `SELECT MIN(v) AS min, MAX(v) AS max, ` +
    `PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY v) AS p50, ` +
    `PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY v) AS p90 ` +
    `FROM ${sampledFrom(expr, pct)} WHERE v IS NOT NULL`;
}

/** Planner row estimate for the User table (instant; no scan). -1/0 when never analyzed → full scan. */
async function estimatedUserRows(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ est: bigint | number | null }>>(
    `SELECT reltuples::bigint AS est FROM pg_class WHERE relname = 'User'`,
  );
  return Number(rows[0]?.est ?? 0);
}

/** Runs the right aggregation for a field's facet kind and assembles the payload. */
export async function computeFieldFacet(field: FieldDef): Promise<FieldFacet> {
  if (!field.facet) throw new Error(`Field ${field.id} has no facet`);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${COMPUTE_TIMEOUT_MS}`);

    const pct = samplePct(await estimatedUserRows(tx));
    const scale = 100 / pct;

    if (field.facet!.kind === "values") {
      const topRows = await tx.$queryRawUnsafe<Array<{ v: string | null; c: bigint }>>(valuesFacetSql(field.id, pct));
      const statRows = await tx.$queryRawUnsafe<Array<{ distinct_approx: bigint; total: bigint }>>(valuesStatsSql(field.id, pct));
      const top: ValueCount[] = topRows
        .filter((r): r is { v: string; c: bigint } => r.v !== null)
        .map((r) => ({ value: r.v, count: Math.round(Number(r.c) * scale) }));
      return {
        kind: "values",
        payload: {
          // distinctApprox is the sampled distinct count (a lower bound on the true
          // cardinality); it's informational only, so we don't scale it.
          top,
          distinctApprox: Number(statRows[0]?.distinct_approx ?? BigInt(0)),
          total: Math.round(Number(statRows[0]?.total ?? BigInt(0)) * scale),
        },
      };
    }

    // range
    const rows = await tx.$queryRawUnsafe<Array<{ min: unknown; max: unknown; p50: unknown; p90: unknown }>>(rangeFacetSql(field.id, pct));
    const r = rows[0] ?? { min: 0, max: 0, p50: 0, p90: 0 };
    const ser = (v: unknown): number | string =>
      v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : String(v ?? "");
    return { kind: "range", payload: { min: ser(r.min), max: ser(r.max), p50: ser(r.p50), p90: ser(r.p90) } };
  }, { timeout: COMPUTE_TIMEOUT_MS + 1_000 });
}
