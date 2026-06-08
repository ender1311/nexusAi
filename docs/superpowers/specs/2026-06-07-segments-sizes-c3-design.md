# C3 — Agent-Targeting via Segment Materialization

**Date:** 2026-06-07
**Sub-project:** Audience › Segments + Sizes, phase C3
**Status:** Design approved, pending spec review

## Goal

A scheduled job materializes each agent-referenced rule-`Segment`'s membership into the
`UserSegment` table, so the existing cron set-intersection path in `select-and-send`
consumes rule-segments with **zero changes** to that route.

C1 (builder) and C2 (sizes overview) are shipped. C3 is the final phase: it makes
rule-defined segments actually usable for agent targeting by materializing their
membership the same way Hightouch-synced segments already are.

## Background

- `UserSegment` is the materialized membership table the cron set-intersection path
  reads. Today it is populated only by Hightouch ingest (`/api/ingest/segments`),
  which does **append-only** upserts (delta syncs, never removes members).
- Rule-`Segment`s (created via the C1 builder) store a rule definition but have **no**
  materialized membership, so agents cannot target them.
- A rule-segment is **fully derived** from its WHERE clause: each run must both add new
  matches AND remove members who no longer match. This differs fundamentally from
  Hightouch's append-only model.
- Because both sources write to the same `UserSegment` table keyed by `segmentName`, a
  naive name-based delete by the rule job could wipe Hightouch-owned rows. The `source`
  column (below) makes the two sources coexist safely.

## Architecture

**Trigger:** A new standalone Vercel cron route — `src/app/api/cron/materialize-segments/route.ts` —
on its own schedule, decoupled from `select-and-send`. Bearer `CRON_SECRET` auth via
`constantTimeEqual`, `maxDuration = 300`.

**Each run:**
1. Collect referenced segment names from all agents
   (`segmentTargeting.includes` + `segmentTargeting.excludes` + legacy `targetSegmentName`).
2. Load the matching `Segment` rows that have a parseable rule definition.
3. For each segment, compile its rule → `CompiledWhere`, then run the Approach-A
   two-statement reconcile in a per-segment transaction with `SET LOCAL statement_timeout`.
4. Per-segment `try/catch` so one bad segment doesn't abort the whole run; record outcome
   to `CronRun`.

**Scope:** Only agent-referenced segments are materialized each run. Segment names that an
agent references but which have no matching rule-`Segment` row (i.e. pure Hightouch
segments) are silently skipped — Hightouch keeps owning them.

## Schema Change

Add a `source` discriminator to `UserSegment`:

```prisma
model UserSegment {
  id          String   @id @default(cuid())
  externalId  String
  segmentName String
  source      String   @default("hightouch")
  syncedAt    DateTime @default(now()) @updatedAt
  @@unique([externalId, segmentName, source])
  @@index([segmentName])
}
```

- The job only ever writes/deletes `source='rule'` rows.
- Hightouch ingest writes `source='hightouch'`.
- `select-and-send` still queries by `segmentName` alone — so it transparently unions
  both sources with no code change.

**Coexistence invariant:** A segment name may receive members from both Hightouch
(append-only deltas) and the rule job (full-replace). The `source` discriminator keeps
the rule job's stale-member sweep from ever deleting Hightouch-owned rows.

**Migration** (`prisma/migrations/<ts>_add_usersegment_source/migration.sql`), idempotent:
- `ALTER TABLE "UserSegment" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'hightouch';`
- `DROP INDEX IF EXISTS "UserSegment_externalId_segmentName_key";` (verify actual name in prod)
- `CREATE UNIQUE INDEX IF NOT EXISTS "UserSegment_externalId_segmentName_source_key" ON "UserSegment" ("externalId", "segmentName", "source");`

Applied via idempotent DDL + `prisma migrate resolve --applied` (never `migrate dev`
against any DB — `prisma.config.ts` loads `.env.local` = PROD).

## Reconcile Mechanism (Approach A)

Per segment, inside one transaction, two statements:

```sql
-- 1. upsert all current matches, stamping syncedAt = runStart
INSERT INTO "UserSegment" (id, "externalId", "segmentName", source, "syncedAt")
SELECT gen_random_uuid(), u."externalId", $name, 'rule', $runStart
FROM "User" u WHERE <compiled rule WHERE>
ON CONFLICT ("externalId", "segmentName", source)
DO UPDATE SET "syncedAt" = $runStart;

-- 2. sweep stale rule-members (anyone not touched this run)
DELETE FROM "UserSegment"
WHERE "segmentName" = $name AND source = 'rule' AND "syncedAt" < $runStart;
```

- Membership never leaves Postgres — scales to millions of users per segment without
  pulling IDs into Node.
- `source='rule'` filter means we never touch Hightouch-owned rows, even when both sources
  share a segment name.
- Uses `$executeRawUnsafe` with the compiled WHERE interpolated and params threaded — the
  same pattern `src/lib/segments/sizing.ts` already uses. Params from `compileSegmentRule`
  are appended after the fixed `$name` / `$runStart` placeholders; placeholder numbering
  must be threaded so the rule's `$1..$n` are offset past the fixed params.
- `gen_random_uuid()` supplies new-row ids (PostgreSQL 17.8, native).

**Rejected alternatives:**
- **App-side diff** (`createMany skipDuplicates` + `deleteMany NOT IN`): pulls every
  matching `externalId` into Node memory — pathological at scale.
- **Delete-all-then-insert**: maximum write churn (rewrites every row every run); the
  watermark approach only writes deltas on the DELETE side.

## Components & File Structure

**New files:**

- `src/lib/segments/materialize.ts`:
  - `collectReferencedSegmentNames(agents): Set<string>` — pulls names from each agent's
    parsed `segmentTargeting` (includes + excludes) + legacy `targetSegmentName`. Reuses
    `parseSegmentTargeting`. Tolerates corrupt JSON (degrades to skip).
  - `materializeSegment(tx, { segmentName, where, runStart }): Promise<{ matched: number; deleted: number }>`
    — runs the two Approach-A statements via `tx.$executeRawUnsafe`, returns counts.
  - `materializeAllSegments({ runStart }): Promise<MaterializeSummary>` — orchestrates:
    collect names → load `Segment` rows → parse+compile each → per-segment txn with
    try/catch → aggregate summary.

- `src/app/api/cron/materialize-segments/route.ts` — thin route handler: `verifyAuth`
  (Bearer `CRON_SECRET`), call `materializeAllSegments`, write a `CronRun` record, return
  `{ data: MaterializeSummary }`. `maxDuration = 300`.

**Modified files:**

- `prisma/schema.prisma` — add `source` to `UserSegment`, widen `@@unique`.
- `prisma/migrations/<ts>_add_usersegment_source/migration.sql` — idempotent DDL (above).
- `src/app/api/ingest/segments/route.ts` (~line 89) — update upsert compound key
  `externalId_segmentName` → `externalId_segmentName_source`, with `source: 'hightouch'`
  in `create`.
- `vercel.json` — add the new cron entry.

**Why `materialize.ts` is separate from the route:** keeps the route a thin boundary
(auth + orchestration call + response shaping) and lets the materialization logic be
unit/integration-tested without HTTP. Matches the existing `sizing.ts` / route split.

## Data Flow (per run)

```
cron fires → verifyAuth → runStart = new Date()
  → load all agents (segmentTargeting, targetSegmentName)
  → collectReferencedSegmentNames → Set<name>
  → prisma.segment.findMany({ where: { name: { in: [...names] } } })
  → for each segment:
       rule = parseSegmentRule(segment.rule)   // skip if null
       where = compileSegmentRule(rule)
       tx: SET LOCAL statement_timeout
           INSERT…SELECT…ON CONFLICT DO UPDATE syncedAt=runStart   → matched
           DELETE … source='rule' AND syncedAt < runStart          → deleted
  → write CronRun(summary)
  → return { data: summary }
```

## Error Handling & Edge Cases

- **Per-segment isolation:** each segment's reconcile runs in its own transaction inside a
  `try/catch`. A compile failure, timeout, or SQL error on one segment records an error in
  the summary and moves on — the run completes for all healthy segments.
- **`statement_timeout` per transaction:** `SET LOCAL statement_timeout = '60s'` guards a
  pathological WHERE (agent-referenced segments are few, so serial 60s budgets fit inside
  the 300s `maxDuration`). On timeout, that segment is marked failed; its membership rows are
  left untouched (the DELETE never runs because the transaction rolls back) —
  stale-but-present beats empty.
- **Unparseable / null rule:** `parseSegmentRule` returns `null` (e.g. unknown `fieldId`
  after a catalog change). Skip the segment — never run a reconcile with a `TRUE` WHERE
  that would match every user. **This is the dangerous case to guard:** a null rule must
  NOT fall through to "match everyone."
- **Empty result set:** a valid rule matching zero users → `INSERT…SELECT` inserts
  nothing, sweep deletes all prior `source='rule'` rows for that name. Correct: the
  segment legitimately empties. Hightouch rows for that name survive (different `source`).
- **Watermark correctness under retries:** `runStart` is captured once at the top of the
  run and used as the literal stamp for every segment. Re-running later uses a fresh,
  larger `runStart`, so a partial previous run self-heals on the next tick.
- **Auth failure:** non-matching Bearer → 401, no DB access.

**Summary shape:**
```ts
type MaterializeSummary = {
  runStart: string;
  segmentsProcessed: number;
  segmentsSkipped: number;   // no rule / unparseable
  segmentsFailed: number;
  perSegment: { name: string; matched: number; deleted: number; error?: string }[];
};
```
Persisted to `CronRun` and returned as `{ data: summary }`.

## Testing Plan

**Unit tests** (`tests/unit/`, no DB):
- `collectReferencedSegmentNames` — dedupes across includes/excludes/legacy
  `targetSegmentName`; tolerates corrupt `segmentTargeting` JSON (degrades to skip);
  empty agents → empty set.
- Null-rule guard — a segment whose `parseSegmentRule` returns null is classified
  skipped, never compiled.

**Integration tests** (`tests/integration/`, real test DB, via `tests/helpers/builders.ts`):
- Happy path: seed users, a rule-`Segment` matching a subset → run
  `materializeAllSegments` → assert exactly the matching `externalId`s exist with
  `source='rule'`.
- **Stale removal:** pre-seed an old `source='rule'` member who no longer matches → after
  run, that row is gone (the core C3 behavior C1/C2 lacked).
- **Hightouch coexistence:** pre-seed a `source='hightouch'` row for the same
  `segmentName` → after run, it survives untouched while rule rows are replaced.
- Empty match: rule matching nobody → all `source='rule'` rows for that name deleted,
  Hightouch rows intact.
- Scope: a segment NOT referenced by any agent is never materialized.

**Regression tests** (`tests/regression/`):
- **SQL column-name guard** (CLAUDE.md mandates this for new `$executeRawUnsafe`): assert
  the INSERT…SELECT/DELETE reference exactly `"externalId"`, `"segmentName"`, `source`,
  `"syncedAt"` — catches schema drift breaking the raw SQL.
- **Ingest compound-key migration** (bug-link comment): the updated `ingest/segments`
  upsert with `externalId_segmentName_source` still upserts correctly and stamps
  `source='hightouch'` — guards the constraint-widening from breaking the existing ingest
  path.

**Route integration test:**
- `materialize-segments` route: 401 on bad/missing Bearer; 200 with `{ data: summary }` on
  valid auth; writes a `CronRun`.

**Cron consumption (the payoff):** an integration test asserting `select-and-send`'s
segment intersection sees rule-materialized members with no code change to that route —
proving the "consumed unchanged" goal.
