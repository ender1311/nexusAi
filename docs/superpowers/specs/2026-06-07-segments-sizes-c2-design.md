# C2 — Audience › Sizes Overview + Exact-Count Caching (Design)

**Date:** 2026-06-07
**Sub-project:** C (Audience › Segments + Sizes), phase **C2**
**Depends on:** C1 (shipped, MR !345) — segment field catalog, rule parser, SQL compiler, sizing lib, `Segment` model, `/api/segment-definitions/*`.
**Followed by:** C3 — agent-targeting via segment materialization.

## Goal

Add `/audience/sizes`: a single overview page listing every saved rule-segment and
every Hightouch-imported segment with its audience size, and make expensive exact
counts for rule-segments **durable** (cached in the database) so they survive
deploys and can be refreshed on demand.

## Background / constraints

- **Two segment sources, different size semantics:**
  - **Rule-segments** (`Segment` table, created by the C1 builder). Size requires
    running the compiled `WHERE` against the ~34M-row `User` table. The cheap
    planner **estimate** (`EXPLAIN FORMAT JSON`, ~50ms, approximate) is computed
    live; the **exact** `COUNT(*)` (up to a 15s statement timeout) is expensive and
    is what C2 caches.
  - **Hightouch segments** (`UserSegment.segmentName`). Size is a membership row
    count already computed and cached by `getCachedSegments()` (tag `"segments"`,
    busted by `POST /api/ingest/segments`). C2 only displays it; it is not
    recomputed here.
- **Shared name namespace.** Rule-segment names and Hightouch segment names share a
  namespace (C1 write paths reject clashes). The two never collide, so a unified
  table is unambiguous.
- **Sizing lib (C1), reused verbatim:**
  - `parseSegmentRule(value: unknown): SegmentRule | null` — `src/lib/segments/parse-rule.ts`
  - `compileSegmentRule(rule: SegmentRule): CompiledWhere` — `src/lib/segments/compile-sql.ts`
  - `estimateSegmentSize(where: CompiledWhere): Promise<number>` — `src/lib/segments/sizing.ts`
  - `exactSegmentSize(where: CompiledWhere): Promise<ExactResult>` where
    `ExactResult = { count: number; timedOut: false } | { count: null; timedOut: true }`
  - `CompiledWhere = { sql: string; params: unknown[] }`
- **Namespace reminder:** rule-segment CRUD + sizing live under
  `/api/segment-definitions/*`, NOT `/api/segments/*` (the latter is the
  pre-existing Hightouch segment-names list endpoint).

## Schema change

Add two nullable columns to the `Segment` model (`prisma/schema.prisma`):

```prisma
model Segment {
  // ... existing fields ...
  sizeExact      Int?       // last computed exact COUNT; null = never computed or last attempt timed out
  sizeComputedAt DateTime?  // when sizeExact was computed; drives the "computed Xh ago" staleness label
}
```

- `Int` is sufficient: max audience (~34M) is well under int4's 2.1B ceiling.
- `null` `sizeExact` means "no exact count yet" (never run, or last run timed out) —
  the UI falls back to the live estimate.
- C3's materialization job can later populate these same columns.

**Migration procedure (no `migrate dev` against any DB — prisma.config.ts loads
`.env.local` = PROD):**
1. Edit `schema.prisma` (add the two columns).
2. Hand-write an idempotent migration folder
   `prisma/migrations/<timestamp>_add_segment_size_cache/migration.sql`:
   ```sql
   ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "sizeExact" INTEGER;
   ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "sizeComputedAt" TIMESTAMP(3);
   ```
3. Apply the same DDL to the local `nexus_test` DB (so integration/regression
   suites match) and to prod via the unpooled connection.
4. `prisma migrate resolve --applied <migration_name>` so Prisma history records it
   without re-running DDL; verify `prisma migrate status` is clean.
5. `npx prisma generate` to refresh the client types.

## Components

### 1. Page — `src/app/audience/sizes/page.tsx`
Replaces the current `<ComingSoon />` placeholder. Async **server component**,
`export const dynamic = "force-dynamic"`, wrapped in `<Header title="Sizes" ... />`
+ `<div className="flex-1 p-6">` (matches `/audience/segments`).

On load, in parallel (`Promise.all`):
- `prisma.segment.findMany({ orderBy: { updatedAt: "desc" }, select: { id, name, description, rule, sizeExact, sizeComputedAt, updatedAt } })`.
- For each rule-segment, compute the **live estimate**:
  `parseSegmentRule(rule)` → if `null`, estimate is `null` (corrupt/invalid rule);
  else `estimateSegmentSize(compileSegmentRule(rule))`. All estimates run inside the
  same parallel batch.
- `getCachedSegments()` → Hightouch `{ name, userCount, assignedTo }[]`.

Then `mergeSegmentSizeRows(ruleSegs, htSegs)` (§3) produces the sorted row model
passed to the client table.

### 2. Unified table — `src/components/segments/segment-sizes-table.tsx` (`"use client"`)
One sortable table. Columns:
- **Name** (+ description subtitle for rule-segments).
- **Type** — badge: `Rule` or `Hightouch`.
- **Size**:
  - Rule row with `sizeExact != null`: exact value (`formatNumber`) + tooltip/label
    `exact · {relative time of sizeComputedAt}`; an `=`/"exact" affordance.
  - Rule row with `sizeExact == null` and estimate present: `≈ {formatNumber(estimate)}`
    + "estimate" affordance.
  - Rule row with `null` estimate (invalid rule): `—` + "invalid rule" badge.
  - Hightouch row: `{formatNumber(userCount)}` (exact membership; no staleness/refresh).
- **Actions**:
  - Rule row: **Refresh** button (recompute this row's exact count) + **Edit in
    builder** link to `/audience/segments`.
  - Hightouch row: read-only (no actions).

Above the table: a **Refresh all** button that recomputes every rule-segment's exact
count **sequentially** (see §5). Empty state (no rule-segments): a prompt linking to
the builder.

### 3. Pure mapper — `src/lib/segments/size-rows.ts`
```ts
type SizeRow =
  | { kind: "rule"; id: string; name: string; description: string | null;
      estimate: number | null; sizeExact: number | null; sizeComputedAt: Date | null;
      updatedAt: Date }
  | { kind: "hightouch"; name: string; userCount: number; assignedTo: string | null };

function mergeSegmentSizeRows(
  ruleSegs: RuleSegInput[],   // includes its computed `estimate: number | null`
  htSegs: HtSegInput[],
): SizeRow[];
```
Merges both sources, sorts descending by **best-available size** (rule:
`sizeExact ?? estimate ?? -1`; hightouch: `userCount`). Pure (no I/O) → unit-tested
directly. Keeps assembly/sort logic out of the page component.

### 4. Refresh endpoint — `POST /api/segment-definitions/[id]/refresh-size`
**Admin-gated** (matches C1 POST/PUT). Steps:
1. Load the segment by `id`; 404 if missing.
2. `parseSegmentRule(seg.rule)`; 400 if it returns `null` (corrupt/invalid rule).
3. `exactSegmentSize(compileSegmentRule(rule))` (15s timeout).
4. Only write the columns when a real count is obtained: persist `sizeExact = count`,
   `sizeComputedAt = now()`. On `timedOut`, do NOT write — leave any prior good value
   intact and return `timedOut: true`.
5. Return `{ data: { count: number | null; computedAt: string | null; timedOut: boolean } }`.

Status codes: **200** success (incl. timeout, with `timedOut:true`), **400** invalid
rule, **403** non-admin, **404** missing, **500** unexpected. Never surface Prisma
internals.

### 5. Client refresh behavior
- **Single row Refresh:** POST to the endpoint for that `id`; show a per-row pending
  spinner; on response, `router.refresh()` to re-pull persisted values. On `timedOut`,
  show "too large — timed out" inline; on 4xx/5xx, show a non-blocking error.
- **Refresh all:** iterate the rule rows **sequentially** (one in flight at a time —
  never parallel, to keep DB load to a single COUNT), POSTing the same endpoint for
  each; show progress (`Refreshing 3/12…`); `router.refresh()` once at the end. A
  timed-out row is skipped (its prior value/estimate stands) and the loop continues.

## Data flow

```
Page (server, force-dynamic)
  ├─ prisma.segment.findMany ──┐
  ├─ estimate each rule (parse→compile→estimate, parallel) ─┤→ mergeSegmentSizeRows → SizeRow[]
  └─ getCachedSegments() ──────┘                                   │
                                                                   ▼
                                          segment-sizes-table (client) renders unified table
                                                                   │ Refresh / Refresh all
                                                                   ▼
                              POST /api/segment-definitions/[id]/refresh-size (admin)
                                  parse→compile→exactSegmentSize(15s)→persist sizeExact+sizeComputedAt
                                                                   │
                                                                   ▼  router.refresh()
                                                            page re-pulls persisted exact counts
```

## Error handling

- **Corrupt/unparseable rule (page assembly):** estimate resolves to `null`; row
  renders `—` + "invalid rule" badge. One bad row never throws or crashes the page
  (tolerant-parse pattern).
- **Exact refresh timeout (>15s):** endpoint returns `timedOut:true`; `sizeExact` not
  overwritten; UI shows "too large — timed out". Refresh-all skips and continues.
- **Hightouch cache empty:** those rows simply absent; page still renders rule rows.
- **Refresh endpoint:** 400 invalid rule, 403 non-admin, 404 missing; generic 500 on
  unexpected — no Prisma messages leaked.

## Caching

- **Page:** `force-dynamic` — estimates are cheap and freshly-persisted exact counts
  must show immediately after a refresh.
- **Hightouch sizes:** existing `getCachedSegments()` (tag `"segments"`, busted on
  ingest); C2 does not change this.
- **Exact counts:** durable in `Segment.sizeExact` / `sizeComputedAt`, displayed with
  a relative staleness label.

## Testing

- **Unit — `tests/unit/segment-size-rows.test.ts`:** `mergeSegmentSizeRows` — merges
  rule + HT sources; tags `kind`; sorts descending by best-available size
  (`sizeExact` preferred over `estimate`); null estimate sorts last and is preserved;
  HT rows sort by `userCount`.
- **Integration — `tests/integration/segment-refresh-size.test.ts`:** the refresh
  endpoint — computes and persists `sizeExact`+`sizeComputedAt`; 403 for non-admin;
  404 for missing id; 400 for a segment with an invalid rule. Uses
  `tests/helpers/builders.ts`.
- **Regression — `tests/regression/sizes-page-corrupt-rule.test.ts`:** a `Segment`
  row with a corrupt `rule` JSON does not crash page-data assembly — its estimate is
  `null` and the rest of the rows still build. Comment links to this design.
- Run `bun run check:quick` while iterating; `bun run check` before the MR.

## Out of scope (deferred to C3)

- Bulk/background materialization of segment membership into `UserSegment`.
- Wiring rule-segments into the cron agent-targeting set-intersection path.
- Scheduled (cron) auto-refresh of exact counts — C2 refresh is user-initiated only.
