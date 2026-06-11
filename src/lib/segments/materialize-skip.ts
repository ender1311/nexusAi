/** Margin below the stored ingest marker that must separate it from the last
 *  materialization before we trust "no user drift". The marker write is
 *  throttled to once per 60s, so up to 60s of User writes can land *after*
 *  the stored marker value; requiring the marker to be at least 2× that
 *  (120s) older than materializedAt guarantees those hidden writes force a
 *  re-scan instead of being skipped until the next sync. */
export const INGEST_MARGIN_MS = 120_000;

/** A segment's re-materialization is a no-op when (a) it has been
 *  materialized before, (b) its rule hasn't been edited since, and (c) no
 *  user ingest has happened since (with the throttle margin above). */
export function shouldSkipMaterialization(args: {
  materializedAt: Date | null;
  updatedAt: Date;
  lastUserIngestAt: Date;
}): boolean {
  const { materializedAt, updatedAt, lastUserIngestAt } = args;
  if (materializedAt === null) return false;
  if (updatedAt.getTime() > materializedAt.getTime()) return false;
  return lastUserIngestAt.getTime() <= materializedAt.getTime() - INGEST_MARGIN_MS;
}
