import { parseSegmentTargeting } from "@/lib/agent-targeting";
import type { Prisma } from "@/generated/prisma/client";
import type { CompiledWhere } from "./compile-sql";
import { prisma } from "@/lib/db";
import { parseSegmentRule } from "./parse-rule";
import { compileSegmentRule } from "./compile-sql";

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

export type MaterializeSummary = {
  runStart: string;
  segmentsProcessed: number;
  segmentsSkipped: number; // null/unparseable rule, or a rule that matches everyone
  segmentsFailed: number; // threw during reconcile (timeout, SQL error)
  perSegment: { name: string; matched: number; deleted: number; error?: string }[];
};

export async function materializeAllSegments(args: { runStart: Date }): Promise<MaterializeSummary> {
  const { runStart } = args;

  const agents = await prisma.agent.findMany({
    select: { segmentTargeting: true, targetSegmentName: true },
  });
  const names = collectReferencedSegmentNames(agents);

  const summary: MaterializeSummary = {
    runStart: runStart.toISOString(),
    segmentsProcessed: 0,
    segmentsSkipped: 0,
    segmentsFailed: 0,
    perSegment: [],
  };

  if (names.size === 0) return summary;

  const segments = await prisma.segment.findMany({
    where: { name: { in: [...names] } },
    select: { name: true, rule: true },
  });

  for (const segment of segments) {
    const rule = parseSegmentRule(segment.rule);
    if (rule === null) {
      summary.segmentsSkipped += 1;
      summary.perSegment.push({ name: segment.name, matched: 0, deleted: 0, error: "unparseable rule" });
      continue;
    }
    const where = compileSegmentRule(rule);
    // An empty rule compiles to "TRUE" (match every user) — refuse to materialize it.
    if (where.sql === "TRUE") {
      summary.segmentsSkipped += 1;
      summary.perSegment.push({ name: segment.name, matched: 0, deleted: 0, error: "empty rule matches all users" });
      continue;
    }
    try {
      const { matched, deleted } = await prisma.$transaction((tx) =>
        materializeSegment(tx, { segmentName: segment.name, where, runStart }),
      );
      summary.segmentsProcessed += 1;
      summary.perSegment.push({ name: segment.name, matched, deleted });
    } catch (err) {
      summary.segmentsFailed += 1;
      summary.perSegment.push({
        name: segment.name,
        matched: 0,
        deleted: 0,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return summary;
}
