import { prisma } from "@/lib/db";

export const USER_INGEST_MARKER_KEY = "last_user_ingest_at";
/** High-frequency ingest must not hammer one AppSetting row — at most one
 *  marker write per minute. The skip predicate compensates with a 2× margin
 *  (see INGEST_MARGIN_MS in materialize-skip.ts). */
export const MARKER_THROTTLE_MS = 60_000;

/** Record "User-table data changed around `now`". Throttled: a no-op when the
 *  stored marker is younger than MARKER_THROTTLE_MS. */
export async function bumpUserIngestMarker(now: Date = new Date()): Promise<void> {
  const existing = await prisma.appSetting.findUnique({
    where: { key: USER_INGEST_MARKER_KEY },
    select: { value: true },
  });
  if (existing) {
    const prev = Date.parse(existing.value);
    if (!Number.isNaN(prev) && now.getTime() - prev < MARKER_THROTTLE_MS) return;
  }
  await prisma.appSetting.upsert({
    where: { key: USER_INGEST_MARKER_KEY },
    create: { key: USER_INGEST_MARKER_KEY, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
}

/** Last time user ingest touched the User table. Fail-open: a missing or
 *  unparseable marker reads as `now`, which makes the skip predicate
 *  materialize everything (today's behavior) — a failure must never skip
 *  toward staleness. */
export async function readUserIngestMarker(now: Date = new Date()): Promise<Date> {
  const row = await prisma.appSetting.findUnique({
    where: { key: USER_INGEST_MARKER_KEY },
    select: { value: true },
  });
  if (!row) return now;
  const parsed = Date.parse(row.value);
  if (Number.isNaN(parsed)) return now;
  return new Date(parsed);
}
