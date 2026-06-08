import { parseSegmentTargeting } from "@/lib/agent-targeting";
import type { Prisma } from "@/generated/prisma/client";
import type { CompiledWhere } from "./compile-sql";

type AgentTargetingFields = {
  segmentTargeting: unknown;
  targetSegmentName: string | null;
};

/** Deduped set of every segment name referenced by any agent (includes, excludes,
 *  and the legacy single-include `targetSegmentName`). Corrupt targeting JSON
 *  degrades to "no names" via the tolerant parser. */
export function collectReferencedSegmentNames(agents: AgentTargetingFields[]): Set<string> {
  const names = new Set<string>();
  for (const agent of agents) {
    const targeting = parseSegmentTargeting(agent.segmentTargeting);
    if (targeting) {
      for (const n of targeting.includes) names.add(n);
      for (const n of targeting.excludes) names.add(n);
    }
    if (agent.targetSegmentName) names.add(agent.targetSegmentName);
  }
  return names;
}

const SEGMENT_TIMEOUT_MS = 60_000;

/** Reconcile one rule-segment's membership inside a transaction:
 *  1. upsert all current matches, stamping syncedAt = runStart
 *  2. sweep source='rule' rows whose syncedAt < runStart (no longer matching)
 *  Returns affected-row counts. The compiled WHERE's params occupy $1..$n; the
 *  fixed segmentName/runStart params are appended after them so the WHERE's
 *  placeholder numbering never needs rewriting. */
export async function materializeSegment(
  tx: Prisma.TransactionClient,
  args: { segmentName: string; where: CompiledWhere; runStart: Date },
): Promise<{ matched: number; deleted: number }> {
  const { segmentName, where, runStart } = args;

  // SET LOCAL only takes effect inside a transaction; guards a pathological WHERE.
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${SEGMENT_TIMEOUT_MS}`);

  const nameParam = `$${where.params.length + 1}`;
  const runStartParam = `$${where.params.length + 2}`;
  const insertSql =
    `INSERT INTO "UserSegment" (id, "externalId", "segmentName", "source", "syncedAt") ` +
    `SELECT gen_random_uuid()::text, u."externalId", ${nameParam}, 'rule', ${runStartParam} ` +
    `FROM "User" u WHERE ${where.sql} ` +
    `ON CONFLICT ("externalId", "segmentName", "source") DO UPDATE SET "syncedAt" = ${runStartParam}`;
  const matched = await tx.$executeRawUnsafe(insertSql, ...where.params, segmentName, runStart);

  const deleted = await tx.$executeRawUnsafe(
    `DELETE FROM "UserSegment" WHERE "segmentName" = $1 AND "source" = 'rule' AND "syncedAt" < $2`,
    segmentName,
    runStart,
  );

  return { matched, deleted };
}
