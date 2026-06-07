# Audience › Segments + Sizes — C1 (Segment Builder Foundation) Design

**Date:** 2026-06-07
**Sub-project:** C (Audience › Segments + Sizes), Phase **C1** of 3
**Status:** Approved (brainstorm complete)

## Context

Sub-project C of the sidebar reorganization. Today, "segments" in Nexus are
**membership lists imported from Hightouch** into the `UserSegment` table
(`externalId`, `segmentName`), consumed by the cron's set-intersection
targeting. There is no way to *build* a segment from raw user fields.

This project introduces **rule-based segments**: a Hightouch-style builder over
a curated field catalog, with estimated + exact SQL sizing, persisted as
named/reusable segments. Both `/audience/segments` and `/audience/sizes` are
currently "Coming soon" placeholders.

### Phasing (decided)

C is too large for one spec, so it is phased; each phase is its own
spec → plan → MR cycle:

- **C1 (this spec):** field catalog, nested rule-tree model + tolerant parser,
  recursive parameterized SQL `WHERE` compiler, sizing service (planner
  estimate + on-demand exact `COUNT`), new `Segment` model + CRUD API, and the
  nested-group builder UI on `/audience/segments`. Independently shippable.
- **C2 (later):** `/audience/sizes` overview page — lists saved rule-segments +
  Hightouch-imported `UserSegment` names, each with its size (+ exact-count
  caching).
- **C3 (later):** agent-targeting integration via **materialization** — a job
  compiles each saved segment's `WHERE` and upserts membership into
  `UserSegment`, so the existing cron set-intersection path consumes
  rule-segments unchanged (keeps dynamic SQL off the hot cron path).

### Decisions captured during brainstorming

- **Purpose:** saved & reusable segments (eventually selectable in agent
  targeting — that's C3).
- **Rule logic:** full nested AND/OR groups, arbitrary depth (Hightouch-style).
- **Sizing:** *estimate* = Postgres query-planner row estimate (`EXPLAIN`),
  sub-second/approximate; *exact* = real `COUNT(*)`, on demand.
- **Field catalog categories (all four):** core scalar columns, curated
  `attributes` keys, `UserSegment` membership (EXISTS subquery), and
  engagement/`channelStats` fields.

## Goal

Let an authenticated admin build a nested AND/OR segment over a curated field
catalog, see its estimated size live and its exact size on demand, and save it
as a named, reusable segment — over the ~10M+ row `"User"` table, without
SQL injection risk and without blocking the database.

---

## Section 1 — Rule-tree data model

`src/types/segment.ts`. A segment's rules are a recursive tree persisted as
JSON.

```ts
export type Operator =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"   // scalar/number/date
  | "in" | "nin"                                  // enum/string set
  | "contains"                                    // string substring
  | "exists" | "nexists"                          // presence
  | "is_true" | "is_false"                        // boolean
  | "in_segment" | "not_in_segment";              // UserSegment membership

export type ConditionValue = string | number | boolean | string[] | null;

export type Condition = {
  kind: "condition";
  fieldId: string;          // references a FieldCatalog entry by id
  operator: Operator;
  value: ConditionValue;
};

export type Group = {
  kind: "group";
  join: "AND" | "OR";
  children: RuleNode[];     // nested groups or conditions, arbitrary depth
};

export type RuleNode = Condition | Group;
export type SegmentRule = Group;   // root is always a group
```

**Tolerant parser** `parseSegmentRule(value: unknown): SegmentRule | null`
(`src/lib/segments/parse-rule.ts`):

- Validates the tree on read. Unknown `fieldId`, an operator illegal for the
  field's type, or a malformed node degrade the **whole tree to `null`** (empty
  segment), never throwing — follows the existing `parseSegmentTargeting`
  precedent.
- Operator legality is delegated to the field catalog (Section 2), so parser,
  compiler, and UI share one source of truth.
- A maximum depth guard (constant, e.g. 10) — trees deeper than the limit parse
  to `null`.

Rationale: discriminated union on `kind` lets parser, compiler, and UI all
narrow on one field; arbitrary nesting falls out of `Group.children:
RuleNode[]`.

---

## Section 2 — Field catalog

`src/lib/segments/field-catalog.ts`. A single curated, typed registry — the
source of truth for what's queryable, which operators each field allows, and
how each compiles to SQL.

```ts
export type FieldType =
  | "string" | "number" | "boolean" | "date" | "enum" | "segment";

// How a field's (operator, value) becomes SQL — see Section 3.
export type FieldCompile =
  | { strategy: "scalar"; column: string }          // native "User" column
  | { strategy: "attr"; key: string; cast: "text" | "numeric" | "boolean" }
  | { strategy: "channelStat"; channel: string; metric: string } // channelStats->channel->>metric
  | { strategy: "segment" };                          // EXISTS on UserSegment

export type FieldDef = {
  id: string;              // stable key stored in conditions, e.g. "funnelStage"
  label: string;           // UI label, e.g. "Funnel stage"
  category: "scalar" | "attribute" | "segment" | "engagement";
  type: FieldType;
  operators: Operator[];   // legal operators for this field
  enumValues?: { value: string; label: string }[]; // for type "enum"; value is stored, label shown
  compile: FieldCompile;
};

export function getField(id: string): FieldDef | undefined;
export function isOperatorLegal(field: FieldDef, op: Operator): boolean; // field.operators.includes(op)
export const FIELD_CATALOG: FieldDef[];
```

**Initial catalog (~18–20 entries):**

- **scalar:** `funnelStage` (enum; `in`/`nin`/`exists`), `persona` (enum;
  `in`/`nin`/`exists`; `compile` is `scalar` on the `personaId` column — the
  condition `value` holds persona **IDs**, while `enumValues` carries
  `{id,label}` pairs so the UI shows names but stores IDs; no join needed),
  `timezone` (string), `createdAt` (date), `totalDecisions` (number),
  `totalConversions` (number).
- **attr** (`attributes->>'key'`, cast per type): `email` (string),
  `country_latest` (string), `language_tag` (string),
  `days_since_last_open` (number), `has_recurring_gift` (boolean),
  `gift_count_lifetime` (number), `newsletter_push_enabled` (boolean),
  `newsletter_email_enabled` (boolean),
  `preferred_channel_overall_30_days` (string).
- **engagement** (`channelStats->'channel'->>'metric'`, numeric):
  `push_sent`, `push_converted`. (More can be added later as catalog entries.)
- **segment** (`UserSegment` membership): `segment_membership` (type
  `"segment"`; operators `in_segment`/`not_in_segment`; value is a segment
  name).

**Operator-by-type rules** (enforced by `operators` arrays per entry):

- number/date: `eq, neq, gt, gte, lt, lte, exists, nexists`
- string: `eq, neq, in, nin, contains, exists, nexists`
- boolean: `is_true, is_false, exists, nexists`
- enum: `in, nin, exists, nexists`
- segment: `in_segment, not_in_segment`

A unit test asserts every entry's `compile.strategy` is consistent with its
`type`/`category` and that `operators` is non-empty, so a malformed addition
fails CI.

---

## Section 3 — Recursive SQL `WHERE` compiler

`src/lib/segments/compile-sql.ts`. Pure function turning a validated
`SegmentRule` into a parameterized SQL fragment. **No user value is ever
interpolated into the SQL string** — every value is a bound parameter.

```ts
export type CompiledWhere = { sql: string; params: unknown[] };

export function compileSegmentRule(rule: SegmentRule): CompiledWhere;
```

**Algorithm:**

- Walk the tree with a single monotonic placeholder counter threaded through
  the recursion (so `$1`, `$2`, … never collide).
- A `Group` compiles each child, joins fragments with ` AND `/` OR `, wraps in
  parentheses: `(c1 AND c2 AND (cA OR cB))`.
- A `Condition` looks up its `FieldDef` and dispatches on `compile.strategy` to
  produce a fragment using positional placeholders, pushing values onto the
  shared `params` array.
- Result is consumed as `SELECT … FROM "User" u WHERE <sql>` by the sizing
  service (and, in C3, by materialization).

**Compile strategies → SQL:**

- **scalar:** `u."column" <op> $n` (column is a compiler-controlled identifier
  from the catalog, never user input). `persona` compiles to
  `u."personaId" <op> $n` against persona IDs — no join.
- **attr:** `(u."attributes"->>'key')::cast <op> $n`; `exists` →
  `u."attributes" ? 'key'`; `nexists` → `NOT (u."attributes" ? 'key')`.
- **channelStat:** `(u."channelStats"->'channel'->>'metric')::numeric <op> $n`.
- **segment:** `EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" =
  u."externalId" AND us."segmentName" = $n)` for `in_segment`;
  `NOT EXISTS (…)` for `not_in_segment`.

**Operator mapping:**

- `eq/neq/gt/gte/lt/lte` → `= / <> / > / >= / < / <=` with one value param.
- `in`/`nin` → `= ANY($n)` / `<> ALL($n)` with a single array param (one
  placeholder, not N).
- `contains` → `<expr> ILIKE $n` where the param is `%value%` (the wildcards are
  added to the *value*, not the SQL string).
- `exists`/`nexists`, `is_true`/`is_false` → presence/boolean fragments with no
  value param (boolean fields cast to boolean and compared to `true`/`false`).

**Edge cases (explicit):**

- **Empty root group** (`children: []`) → `TRUE` (matches everyone); UI surfaces
  "no filters — matches all users."
- **Empty nested group** → dropped from its parent's join.
- **Type casts** are baked into each strategy, never driven by user input.
- **Depth** is already capped by the parser (Section 1); the compiler trusts a
  parsed tree.

Unit-tested with hand-built trees asserting exact `sql` + `params` for every
operator and nesting case.

---

## Section 4 — Sizing service

`src/lib/segments/sizing.ts`. Two functions over a `CompiledWhere`.

```ts
export type ExactResult = { count: number; timedOut: false } | { count: null; timedOut: true };

export function estimateSegmentSize(where: CompiledWhere): Promise<number>;
export function exactSegmentSize(where: CompiledWhere): Promise<ExactResult>;
```

- **Estimate:** `EXPLAIN (FORMAT JSON) SELECT 1 FROM "User" u WHERE <sql>` with
  params; read `Plan["Plan Rows"]`; return integer. Sub-second (planner uses
  column statistics, touches no rows). Shown live (debounced) as the user edits.
- **Exact:** `SELECT COUNT(*) FROM "User" u WHERE <sql>` with params. On-demand
  only (button). Wrapped in a `statement_timeout` (15s); on timeout returns
  `{ count: null, timedOut: true }` → UI shows "exact count timed out — refine
  the segment."
- Both use `prisma.$queryRawUnsafe(sql, ...params)` — "unsafe" only because the
  SQL **string** is assembled by our own compiler; every user **value** is a
  bound parameter.
- **No exact-count caching in C1** (explicit, on-demand, inline result). Caching
  belongs with C2's multi-segment overview.

A regression test asserts the assembled SQL contains only `$n` placeholders and
no inlined literals (injection-boundary guard).

---

## Section 5 — Persistence model + CRUD API

**New Prisma model** (`prisma/schema.prisma`):

```prisma
model Segment {
  id          String   @id @default(cuid())
  name        String   @unique          // human label; also UserSegment.segmentName in C3
  description String?
  rule        Json                       // serialized SegmentRule tree
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?                    // WorkOS user id/email, best-effort

  @@map("Segment")
}
```

- `name` unique so C3 can materialize membership into `UserSegment` by this name
  without colliding with Hightouch-imported names. `POST`/`PUT` reject a name
  that already exists as a distinct `UserSegment.segmentName` (409), keeping the
  two namespaces coherent.
- **Migration ships as idempotent DDL + manual migration folder +
  `prisma migrate resolve --applied`** — never `prisma migrate dev` against any
  DB (prisma.config.ts loads `.env.local` = PROD). `CREATE TABLE IF NOT EXISTS`
  on prod; insert the `_prisma_migrations` row directly on the test DB.

**Routes** (all `{ data }`/`{ error }`, validate before DB access, correct
status codes, `handleRouteError` for P2002→409 / P2025→404):

- `GET /api/segments` → `{ data: SegmentSummary[] }` (id, name, description,
  updatedAt; no rule tree). Read — app auth middleware.
- `POST /api/segments` — body `{ name, description?, rule }`; validate name
  non-empty + unique (409), parse+validate rule (400 invalid/too-deep), persist.
  `requireAdmin()`.
- `GET /api/segments/[id]` → `{ data: Segment }` with parsed rule tree (404 if
  missing). Read.
- `PUT /api/segments/[id]` — same validation as POST. `requireAdmin()`.
- `DELETE /api/segments/[id]` — 404 if missing. `requireAdmin()`.
- `POST /api/segments/size` — body `{ rule, mode: "estimate" | "exact" }` →
  `{ data: { count, mode, timedOut? } }`. Stateless (sizes an unsaved draft).
  Compile + run sizing. 400 on invalid rule. Read (no mutation) — app auth
  middleware.

Mutations call `requireAdmin()`; reads rely on app auth middleware (consistent
with sub-project B's read routes).

---

## Section 6 — Builder UI (`/audience/segments`)

Replaces the "Coming soon" placeholder. Server Component page shell + a
`"use client"` builder; initial data fetched in the page and passed as props
(no `useEffect` for initial load).

**Layout:**

- **Left — saved segments list:** from `GET /api/segments`; click loads a
  segment into the editor; "New segment" button; each row shows name +
  last-updated.
- **Right — editor:**
  - Name + description inputs.
  - **Rule tree editor:** a single recursive `<RuleNodeEditor>` component. A
    `Group` renders its `AND`/`OR` toggle, its children (condition rows or
    nested groups), and "+ Condition" / "+ Group" buttons. A `Condition` row =
    field picker (grouped by catalog `category`) → operator dropdown (from the
    selected field's `operators`) → type-adaptive value input (text, number,
    enum multi-select, boolean toggle, segment-name picker). Remove buttons on
    every node.
  - **Live estimate:** on every edit, debounced ~400ms, `POST
    /api/segments/size {mode:"estimate"}` → "≈ N users"; in-flight shows
    "estimating…".
  - **Exact count button:** `{mode:"exact"}` → spinner → exact number or the
    timed-out message.
  - **Save:** POST/PUT; on success `router.refresh()` (respects tag
    invalidation). Delete with confirm.

**Logic stays in `lib/`:** the component holds only the draft tree + orchestrates
fetches. Tree mutation helpers (add/remove/update node at a path) are pure
functions in `src/lib/segments/rule-tree-ops.ts`, unit-tested independent of
React. The segment-name picker's choices (distinct `UserSegment.segmentName`)
and the persona enum's `{id,label}` pairs are loaded in the page's server-side
fetch and passed as props to the builder.

Nav already lists `/audience/segments`; no nav change.

---

## Section 7 — Error handling

- Invalid/malformed/too-deep rule → `parseSegmentRule` returns `null` (or depth
  guard) → routes **400**, generic message; never a Prisma/SQL error to client.
- Duplicate name (vs another `Segment` or an existing `UserSegment.segmentName`)
  → **409**.
- Missing segment on GET/PUT/DELETE → **404** via `handleRouteError`.
- Exact-count `statement_timeout` → typed `{ timedOut: true }`, **200**; UI
  shows "refine the segment" (not an error).
- Sizing/SQL failures logged server-side; client gets generic **500**.
- Corrupt stored `rule` JSON on read degrades that segment to an empty tree
  (tolerant-parse precedent) — one bad row never breaks the list.

---

## Testing

Per the standing test rules (builders from `tests/helpers/builders.ts`; never
run tests in background; `bun run check:quick` while iterating, full
`bun run check` before MR).

- **Unit (`tests/unit/`):**
  - `compile-sql`: exact `sql` + `params` for every operator + nesting,
    empty-group, `in`/`nin` array param, `contains` wildcard-in-value,
    `segment` EXISTS.
  - `field-catalog`: each entry's `compile.strategy` matches its `type`/
    `category`; `operators` non-empty.
  - `rule-tree-ops`: add/remove/update-node-at-path purity.
  - `parse-rule`: valid trees; unknown field / illegal operator / malformed /
    too-deep → `null`.
- **Integration (`tests/integration/`):** every route — `POST /api/segments`
  (create, dup→409, invalid rule→400, requireAdmin), `GET` list/detail, `PUT`,
  `DELETE`→404, and `POST /api/segments/size` for estimate + exact against
  seeded users.
- **Regression (`tests/regression/`):** sizing `$queryRawUnsafe` SQL contains
  only `$n` placeholders, no inlined literals (injection boundary); the
  `/audience/segments` page renders the builder, not "Coming soon."

---

## Out of scope for C1 (explicit)

- `/audience/sizes` overview page → **C2**.
- Materializing rule-segments into `UserSegment`; any cron/agent-targeting
  consumption of rule-segments → **C3**.
- Exact-count caching → **C2**.
- Channel-stat fields beyond `push_sent`/`push_converted` (add later as catalog
  entries).

## File structure (C1)

- Create: `src/types/segment.ts` — rule-tree types.
- Create: `src/lib/segments/field-catalog.ts` — catalog + `getField`.
- Create: `src/lib/segments/parse-rule.ts` — tolerant parser + depth guard.
- Create: `src/lib/segments/compile-sql.ts` — recursive SQL compiler.
- Create: `src/lib/segments/sizing.ts` — estimate + exact.
- Create: `src/lib/segments/rule-tree-ops.ts` — pure tree mutation helpers.
- Create: `src/app/api/segments/route.ts` — GET list, POST create.
- Create: `src/app/api/segments/[id]/route.ts` — GET/PUT/DELETE.
- Create: `src/app/api/segments/size/route.ts` — POST size.
- Modify: `src/app/audience/segments/page.tsx` — replace placeholder.
- Create: `src/components/segments/segment-builder.tsx` — client builder.
- Create: `src/components/segments/rule-node-editor.tsx` — recursive editor.
- Modify: `prisma/schema.prisma` — `Segment` model.
- Create: `prisma/migrations/<ts>_add_segment_model/migration.sql`.
- Tests as enumerated above.
