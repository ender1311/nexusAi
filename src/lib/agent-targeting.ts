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
