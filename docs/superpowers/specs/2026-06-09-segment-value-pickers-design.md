# Segment Builder Value Pickers — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

The audience segment builder lets users add conditions of the form
`field operator value` (e.g. `Country = US`). Today only three fields render as
pickers — `funnelStage` (static enum), `persona` and `segment_membership` (loaded
from props). **Every other string field — Country, Language, Timezone, Preferred
channel, Email — is a raw free-text box.**

This forces users who don't know the underlying data to guess at the exact stored
representation: is it `US` or `United States`? `en` or `en-US`? `push` or
`push_notification`? A wrong guess silently produces an empty or incorrect segment
with no error. Number/date fields have the same blind-guess problem for sane ranges.

**Goal:** make it easy for someone who doesn't know the data to build a correct
segment, by surfacing the actual values that exist in the data (with counts) as a
searchable picker, plus range hints for numeric/date fields — comprehensively across
the field catalog.

## Decisions (locked during brainstorming)

1. **Value source: live from the data.** Suggested values are the real distinct
   values stored in the `User` table, with row counts, sorted by frequency. This is
   what directly solves "US vs United States" — the picker shows exactly what's
   stored, so the user never guesses.
2. **Caching: cron-refreshed facet cache table.** Distinct/aggregate queries over the
   large `User` table (Country/Language live inside the `attributes` JSON column) are
   too expensive to run on interaction. A background cron precomputes top-N
   values + counts (and numeric ranges) into a small cache table; the UI reads only
   the cache. Slight staleness is acceptable for categorical fields.
3. **Input model: searchable combobox + free-text fallback.** Type-ahead over the
   cached values; multi-select chips for `in`/`nin`; single-select for `eq`/`neq`.
   Users CAN still commit a value not in the list (covers uncached/brand-new values
   and the `contains` operator). Easy for novices, no ceiling for power users.
4. **Coverage: categorical pickers + range hints for number/date.** Combobox for
   categorical string fields; a min/max/median hint line for number/date fields;
   email stays free-text (too high cardinality); booleans already use
   `is_true`/`is_false`.
5. **Delivery: server-load facets as props (no new read API).** The audience page
   server component bulk-loads all facet rows (tiny table) and passes them to the
   builder as a prop map, mirroring `personaOptions`/`segmentNameOptions`. The
   combobox filters the in-memory list (200 countries / 400 timezones is trivial to
   filter client-side).
6. **Friendly labels: include a static code→name map for Country/Language.** Rows
   render `US · United States — 174,018`. The formatter degrades to the raw value
   when a code is unmapped.

## Non-goals

- No distribution mini-chart / histogram (possible future follow-up).
- No value picker for `email` (free-text only — cardinality too high to be useful).
- No change to how segments compile, size, materialize, or trigger. The picker is a
  pure input-assistance layer; the chosen value flows through the exact same
  `parse-rule` → `compile-sql` path as a hand-typed value.

## Architecture

### Data flow

```
cron (schedule) ──► refresh-segment-facets route
                      │  for each facetable field in catalog:
                      │    build aggregation SQL from leftExpr() (catalog-derived)
                      │    run GROUP BY / range query (statement_timeout guard)
                      └► upsert SegmentFieldFacet row { fieldId, kind, payload, computedAt }

audience page (server component)
   loads all SegmentFieldFacet rows ──► facetMap: Record<fieldId, Facet>
   passes facetMap as prop to <SegmentBuilder>

<SegmentBuilder> → EditorContext → <RuleNodeEditor> → <ValueEditor>
   facet.kind === "values" → <ValueCombobox>  (searchable, counts, free-text fallback)
   facet.kind === "range"  → number/date input + muted range hint line
   no facet                → unchanged (email text; booleans/enums/persona/segment as today)
```

### Units & responsibilities

| Unit | File | Responsibility |
|------|------|----------------|
| Catalog metadata | `src/lib/segments/field-catalog.ts` | Adds `facet?: FieldFacet` to `FieldDef`; classifies every field |
| Facet types | `src/lib/segments/facet-types.ts` (new) | `FieldFacet`, `ValuesFacetPayload`, `RangeFacetPayload`, tolerant parser |
| Facet labels | `src/lib/segments/facet-labels.ts` (new) | `countryName`/`languageName` maps + `formatFacetValueLabel(fieldId, value, count)` |
| Facet compute | `src/lib/segments/facet-compute.ts` (new) | Pure-ish builders that, given a `FieldDef`, return the aggregation SQL using `leftExpr()` |
| Cron route | `src/app/api/cron/refresh-segment-facets/route.ts` (new) | `CRON_SECRET`-gated; runs compute for each facetable field; upserts cache |
| Cache table | `prisma/schema.prisma` + migration | `SegmentFieldFacet` |
| Server load | audience page server component | Bulk-load facet rows → prop map |
| Combobox | `src/components/segments/value-combobox.tsx` (new) | shadcn Popover+Command picker (single/multi, free-text fallback) |
| Combobox filter | `src/lib/segments/facet-filter.ts` (new) | Pure typeahead-filter + ranking helper (tested separately) |
| ValueEditor wiring | `src/components/segments/rule-node-editor.tsx` | Dispatch on `field.facet.kind` |

Keeping the filter logic, label formatter, payload parser, and SQL builders in
`lib/` (not inline in components/routes) follows the repo convention that
precedence/derivation logic lives in tested pure helpers, not duplicated in views.

## Data model

```prisma
model SegmentFieldFacet {
  fieldId    String   @id          // matches FieldDef.id
  kind       String                // "values" | "range"
  payload    Json                  // see payload shapes below
  computedAt DateTime @updatedAt
}
```

**`values` payload:**
```ts
type ValuesFacetPayload = {
  top: { value: string; count: number }[];   // up to 50, desc by count
  distinctApprox: number;                     // count(distinct) at compute time
  total: number;                              // non-null rows for this field
};
```

**`range` payload:**
```ts
type RangeFacetPayload = {
  // numbers stored as number; dates stored as ISO strings (parser narrows per field type)
  min: number | string;
  max: number | string;
  p50: number | string;
  p90: number | string;
};
```

Dates store ISO strings; numbers store numbers. The parser narrows per `kind`.

### Migration (idempotent, established pattern)

Raw DDL applied to the test DB and prod separately via
`DATABASE_URL_UNPOOLED`, then `npx prisma migrate resolve --applied "<migration>"`.
**Never** `prisma migrate dev`/`db push` (prisma.config.ts loads `.env.local` = prod).
After `prisma generate`, revert any `apps/api/src/generated/prisma/` churn.

```sql
CREATE TABLE IF NOT EXISTS "SegmentFieldFacet" (
  "fieldId"    TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SegmentFieldFacet_pkey" PRIMARY KEY ("fieldId")
);
```

Add `prisma.segmentFieldFacet.deleteMany().catch(() => {})` to `truncateAll()` in
`tests/helpers/db.ts` (FK-safe — no relations, place near the other lookup tables).

## Catalog metadata

```ts
export type FieldFacet =
  | { kind: "values" }
  | { kind: "range" };

// FieldDef gains:  facet?: FieldFacet;
```

Classification (exhaustive — a unit test asserts every catalog field is intentionally
either facetable or explicitly excluded):

| Field | facet |
|-------|-------|
| `country_latest`, `language_tag`, `timezone`, `preferred_channel_overall_30_days` | `{ kind: "values" }` |
| `createdAt`, `totalDecisions`, `totalConversions`, `days_since_last_open`, `gift_count_lifetime`, `push_sent`, `push_converted` | `{ kind: "range" }` |
| `funnelStage`, `persona`, `segment_membership` | none (existing dropdowns) |
| `email` | none (free-text; cardinality) |
| `has_recurring_gift`, `newsletter_push_enabled`, `newsletter_email_enabled` | none (boolean ops) |

## Facet compute

The compute builder takes a `FieldDef` and returns parameterized aggregation SQL using
the **same `leftExpr()` from `compile-sql.ts`** that the rule compiler uses, so the
column/JSON-path expression is catalog-derived and never hand-written per field (DRY +
injection-safe).

- **values:**
  `SELECT <leftExpr> AS v, count(*) AS c FROM "User" u WHERE <leftExpr> IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 50`
  plus a `count(distinct <leftExpr>)` and a `count(*) WHERE <leftExpr> IS NOT NULL` for
  `distinctApprox`/`total`.
- **range (number):**
  `SELECT min(<expr>::numeric), max(...), percentile_cont(0.5) WITHIN GROUP (ORDER BY ...), percentile_cont(0.9) ...`
- **range (date):** same with date casting; serialize to ISO strings.

The cron route:
- Auth: `CRON_SECRET` (constant-time comparison, matching existing cron/ingest routes).
- For each facetable field: run its query inside a transaction with
  `SET LOCAL statement_timeout` (generous — this is a background job, e.g. 60s);
  on per-field failure, log and continue (one slow/failing field must not abort the
  whole refresh). Upsert the `SegmentFieldFacet` row.
- Returns `{ data: { refreshed: string[]; failed: string[] } }`.
- Registered in `vercel.json` crons (schedule: daily is sufficient; categorical data
  drifts slowly).

## Server load

The audience page server component loads `prisma.segmentFieldFacet.findMany()` (≈15
rows), parses each payload with the tolerant parser (corrupt/missing → omitted), and
builds `facetMap: Record<string, FieldFacet & { payload }>`. Passes it into
`EditorContext` alongside `personaOptions`/`segmentNameOptions`. Wrap in the existing
server-side cache helper so repeated renders don't re-query.

## UI

### `ValueCombobox` (`src/components/segments/value-combobox.tsx`, `"use client"`)

- shadcn `Popover` + `Command` (add via `npx shadcn add` if not present).
- Props: `{ values: {value,count}[]; fieldId; multi: boolean; selected; onChange }`.
- Each row label via `formatFacetValueLabel(fieldId, value, count)` →
  `US · United States — 174,018` (country/language) or `push_notification — 12,043`.
- Filtering via the pure `facet-filter.ts` helper (case-insensitive substring on both
  raw value and friendly name; cached values ranked by count).
- **Free-text fallback:** when the typed query matches nothing, the command list shows
  a `Use "<typed>"` action that commits the raw typed value. Guarantees `contains` and
  uncached values still work.
- `multi` (for `in`/`nin`): selected values render as removable chips; value stored as
  `string[]`. Single (`eq`/`neq`): value stored as scalar string.

### `ValueEditor` dispatch (`rule-node-editor.tsx`)

Order of checks (first match wins):
1. valueless operator (`exists`/`nexists`/`is_true`/`is_false`) → no input (unchanged).
2. `segment_membership` → segment dropdown (unchanged).
3. existing enum (`field.enumValues` or `persona`) → multi-select (unchanged).
4. **`field.facet?.kind === "values"`** → `<ValueCombobox multi={isArrayOp(operator)} ...>`.
5. **`field.facet?.kind === "range"`** → existing number/date `<input>` + muted hint
   line `In data: {min}–{max} · median {p50}` (rendered only if a facet payload exists).
6. else → existing free-text input (unchanged; covers `email`).

### Friendly labels (`facet-labels.ts`)

- `countryName: Record<string,string>` — ISO-3166 alpha-2 → English name (the ~200
  codes; a static object).
- `languageName: Record<string,string>` — common BCP-47 / ISO-639 tags → English name.
- `formatFacetValueLabel(fieldId, value, count)`:
  - country/language and code is mapped → `${value} · ${name} — ${count.toLocaleString()}`
  - otherwise → `${value} — ${count.toLocaleString()}`

## Error handling & invariants

- **Cold/empty cache** (before first cron run, or a field's compute failed): no facet
  row → `ValueEditor` falls back to the plain text input. No crash, no blocking.
- **Corrupt payload:** tolerant parser returns `null` for that field → treated as no
  facet (free-text fallback).
- **Compilation invariant (critical):** the picker only changes *how the value is
  entered*. The selected value is the same `ConditionValue` shape (`string` or
  `string[]`) that free-text produces, and flows through the unchanged
  `parse-rule` → `compile-sql` → sizing/materialize/trigger path. A regression test
  asserts a picker-built rule compiles to byte-identical SQL+params as the same rule
  typed by hand.

## Testing

**Unit (`tests/unit/`):**
- `segment-facet-classification.test.ts` — every catalog field is either facetable
  (with the expected `kind`) or in an explicit excluded set; no field is unclassified.
- `segment-facet-parse.test.ts` — payload parser narrows by `kind`; tolerant of
  corrupt/missing JSON (returns null, never throws).
- `segment-facet-labels.test.ts` — `formatFacetValueLabel` for mapped country (`US ·
  United States — …`), mapped language, unmapped code (raw value + count), non-
  country field (value + count).
- `segment-facet-filter.test.ts` — case-insensitive match on raw value AND friendly
  name; ranking by count; empty-query returns full list.
- `segment-facet-compute-sql.test.ts` — the compute builder emits the expected SQL
  using `leftExpr` for a scalar field, an attribute field, and a channelStat field;
  range builder emits min/max/percentile SQL.

**Integration (`tests/integration/`):**
- `refresh-segment-facets.test.ts` — seed users with known countries/languages and
  numeric values via `tests/helpers/builders.ts`; run the cron handler; assert
  `SegmentFieldFacet` rows exist with correct `top` counts (desc), `total`, and range
  min/max/p50. Assert `CRON_SECRET` gate rejects unauthenticated calls.

**Component (`tests/unit/` with @testing-library/react + happy-dom):**
- `value-editor.test.tsx` — renders `ValueCombobox` for `country_latest` (with facet
  prop), renders the range hint for a number field, renders plain text input for
  `email`; typing an unlisted value and committing it sets the raw value (free-text
  fallback).

**Regression (`tests/regression/`):**
- `segment-picker-compiles-identically.test.ts` — a rule whose value was chosen via the
  picker compiles to the same SQL+params as the identical hand-typed rule (guards the
  no-change-to-compilation invariant). Comment links this design.
- The compute SQL is `$queryRaw` over the `User` table → per CLAUDE.md, the
  compute-sql unit test verifies exact column/JSON-path names.

## Build order

1. `SegmentFieldFacet` table + migration + `truncateAll()` entry.
2. Facet types + tolerant parser + label maps + filter helper (pure lib, tested).
3. Catalog `facet` metadata + classification test.
4. Facet compute builders + cron route + integration test.
5. Server-load facet map into the audience page + `EditorContext`.
6. `ValueCombobox` + `ValueEditor` dispatch + component test.
7. Regression test (picker ≡ hand-typed compile) + full `bun run check`.

Backend facets (1–4) are the foundation; UI (5–6) consumes them. Steps 1–4 ship a
populated cache with zero user-visible change; 5–6 light up the UI.
