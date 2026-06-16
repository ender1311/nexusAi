/**
 * Per-run segment-membership loader for the select-and-send cron.
 *
 * Every agent's recruitment needs the member sets of its include/exclude
 * segments. Without sharing, each agent re-queries UserSegment independently, so
 * a segment referenced by multiple agents (e.g. "giving-has-given" is one agent's
 * include and another's exclude) is pulled from the DB once per agent, every run
 * — a ~105K-row transfer each time. That redundant load contends with concurrent
 * Hightouch ingest and was pushing busy runs past the function timeout.
 *
 * This builds a loader that memoizes on the in-flight Promise, so each unique
 * segment is fetched exactly once per run and concurrent callers share the same
 * query. Pure w.r.t. the DB: the caller injects `fetchMembers`, so it's unit
 * testable without a database.
 */
export function createSegmentMemberLoader(
  fetchMembers: (segmentName: string) => Promise<string[]>,
): (segmentName: string) => Promise<Set<string>> {
  const cache = new Map<string, Promise<Set<string>>>();
  return (segmentName: string): Promise<Set<string>> => {
    let cached = cache.get(segmentName);
    if (!cached) {
      cached = fetchMembers(segmentName).then((ids) => new Set(ids));
      cache.set(segmentName, cached);
    }
    return cached;
  };
}
