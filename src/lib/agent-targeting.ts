export type SegmentTargeting = { includes: string[]; excludes: string[] };

/**
 * Resolves the agent's `segmentTargeting` payload field from the targeting UI state.
 * Shared by the create wizard and the edit sheet so the two never drift.
 *
 * In segment mode, includes are required (AND-match); excludes are optional.
 * Out of segment mode (funnel-stage targeting), only standalone excludes carry over.
 * Returns null when there is nothing to persist.
 */
export function resolveSegmentTargeting(
  segmentMode: boolean,
  includes: string[],
  excludes: string[],
): SegmentTargeting | null {
  if (segmentMode) {
    return includes.length > 0 ? { includes, excludes } : null;
  }
  return excludes.length > 0 ? { includes: [], excludes } : null;
}

/**
 * Validate a raw `Agent.segmentTargeting` JSON value (read path) into a clean
 * SegmentTargeting. The column is written by validated API routes, but reads
 * still go through Prisma's untyped JsonValue, and the resulting strings flow
 * straight into `where: { segmentName: { in: ... } }` queries — a non-string
 * member would make Prisma throw. Tolerant by design: anything that isn't a
 * string array collapses to empty, so a corrupt row degrades to "no targeting"
 * rather than crashing the cron run.
 */
export function parseSegmentTargeting(value: unknown): SegmentTargeting | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const stringArray = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  const includes = stringArray(record.includes);
  const excludes = stringArray(record.excludes);
  if (includes.length === 0 && excludes.length === 0) return null;
  return { includes, excludes };
}
