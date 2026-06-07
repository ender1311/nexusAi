import { prisma } from "@/lib/db";
import type { CompiledWhere } from "./compile-sql";

const EXACT_TIMEOUT_MS = 15_000;

export type ExactResult = { count: number; timedOut: false } | { count: null; timedOut: true };

/** Fast, approximate: the Postgres planner's row estimate (no rows scanned). */
export async function estimateSegmentSize(where: CompiledWhere): Promise<number> {
  const sql = `EXPLAIN (FORMAT JSON) SELECT 1 FROM "User" u WHERE ${where.sql}`;
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...where.params);
  // Postgres returns one row, column "QUERY PLAN" = [ { Plan: { "Plan Rows": N, ... } } ]
  const plan = rows[0]?.["QUERY PLAN"] as Array<{ Plan?: { "Plan Rows"?: number } }> | undefined;
  const estimate = plan?.[0]?.Plan?.["Plan Rows"];
  return typeof estimate === "number" ? Math.round(estimate) : 0;
}

/** Slow, exact: real COUNT(*) wrapped in a per-statement timeout. */
export async function exactSegmentSize(where: CompiledWhere): Promise<ExactResult> {
  const sql = `SELECT COUNT(*)::bigint AS n FROM "User" u WHERE ${where.sql}`;
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${EXACT_TIMEOUT_MS}`);
      return tx.$queryRawUnsafe<Array<{ n: bigint }>>(sql, ...where.params);
    });
    return { count: Number(rows[0]?.n ?? BigInt(0)), timedOut: false };
  } catch (err) {
    // Postgres raises a statement-timeout error (SQLSTATE 57014); treat as a soft timeout.
    if (err instanceof Error && /statement timeout|57014|canceling statement/i.test(err.message)) {
      return { count: null, timedOut: true };
    }
    throw err;
  }
}
