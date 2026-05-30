/**
 * One-time backfill for push-open attribution.
 *
 * Context: before the braze-id↔externalId bridge fix, every push open landed
 * unmatched and its eventId was written to ProcessedEventId. Those rows now
 * short-circuit the idempotency gate, so live re-ingest will never retry them.
 * This script replays the (now-fixed) time-window match directly against the
 * opens already recorded in ProcessedEventId and stamps pushOpenAt on the
 * matching UserDecisions.
 *
 * Source of opens: ProcessedEventId composite ids of the form
 *   `<brazeId??externalId>:<occurred_at ISO>`
 * (only pushOpenToEvent emits composites, so composite rows == push opens).
 * Rows keyed on a real Hightouch push_notification_event_id can't be parsed
 * and are skipped — those would need a re-sync, not a replay.
 *
 * Mirrors the live time-window matcher: each open consumes the most-recent
 * unstamped push decision whose sentAt falls in [occurredAt-48h, occurredAt].
 *
 * Usage:
 *   bun run scripts/backfill-push-opens.ts            # dry-run (no writes)
 *   bun run scripts/backfill-push-opens.ts --apply    # write pushOpenAt
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const WINDOW_MS = 48 * 60 * 60 * 1000;

function parseOccurredAt(eventId: string): Date | null {
  // Composite = `<id>:<ISO>`; id has no colon, ISO does, so split on FIRST colon.
  const idx = eventId.indexOf(":");
  if (idx < 0) return null;
  const iso = eventId.slice(idx + 1);
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

const decisions = await prisma.userDecision.findMany({
  where: { channel: "push", pushOpenAt: null, brazeSendId: { not: null } },
  select: { id: true, userId: true, sentAt: true },
  orderBy: { sentAt: "asc" },
});

console.log(`Push decisions awaiting attribution: ${decisions.length}`);
if (decisions.length === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

const userIds = [...new Set(decisions.map((d) => d.userId))];
const tracked = await prisma.trackedUser.findMany({
  where: { externalId: { in: userIds } },
  select: { externalId: true, brazeId: true },
});
const externalToBraze = new Map<string, string>();
for (const t of tracked) if (t.brazeId) externalToBraze.set(t.externalId, t.brazeId);

// Group unstamped decisions by user (each list stays sorted by sentAt asc).
const byUser = new Map<string, { id: string; sentAt: Date; stamped: Date | null }[]>();
for (const d of decisions) {
  const list = byUser.get(d.userId) ?? [];
  list.push({ id: d.id, sentAt: d.sentAt, stamped: null });
  byUser.set(d.userId, list);
}

let opensFound = 0;
let toStamp = 0;
const updates: { id: string; pushOpenAt: Date }[] = [];

for (const [userId, list] of byUser) {
  const prefixes = [...new Set([userId, externalToBraze.get(userId)].filter(Boolean) as string[])];

  // Pull every composite open recorded for this user's id forms.
  const opens: Date[] = [];
  for (const p of prefixes) {
    const rows = await prisma.processedEventId.findMany({
      where: { eventId: { startsWith: `${p}:` } },
      select: { eventId: true },
    });
    for (const r of rows) {
      const occurredAt = parseOccurredAt(r.eventId);
      if (occurredAt) opens.push(occurredAt);
    }
  }
  opens.sort((a, b) => a.getTime() - b.getTime());
  opensFound += opens.length;

  // Replay: each open claims the most-recent unstamped decision in its window.
  for (const occurredAt of opens) {
    const windowStart = occurredAt.getTime() - WINDOW_MS;
    let best: { id: string; sentAt: Date; stamped: Date | null } | null = null;
    for (const dec of list) {
      if (dec.stamped) continue;
      const t = dec.sentAt.getTime();
      if (t <= occurredAt.getTime() && t >= windowStart) {
        if (!best || dec.sentAt.getTime() > best.sentAt.getTime()) best = dec;
      }
    }
    if (best) {
      best.stamped = occurredAt;
      toStamp++;
      updates.push({ id: best.id, pushOpenAt: occurredAt });
    }
  }
}

console.log(`Users: ${byUser.size} | composite opens found: ${opensFound} | decisions matched: ${toStamp}`);

if (!APPLY) {
  console.log("\nDRY RUN — no writes. Re-run with --apply to stamp pushOpenAt.");
  for (const u of updates.slice(0, 20)) {
    console.log(`  would stamp ${u.id} → ${u.pushOpenAt.toISOString()}`);
  }
  if (updates.length > 20) console.log(`  …and ${updates.length - 20} more`);
  await prisma.$disconnect();
  process.exit(0);
}

let applied = 0;
for (const u of updates) {
  await prisma.userDecision.update({ where: { id: u.id }, data: { pushOpenAt: u.pushOpenAt } });
  applied++;
}
console.log(`\n✓ Applied: stamped pushOpenAt on ${applied} decisions.`);
await prisma.$disconnect();
