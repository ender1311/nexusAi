# Audience › Search Users — Design Spec

**Date:** 2026-06-07
**Sub-project:** B (of the sidebar reorg: A=nav skeleton [merged], B=Search Users, C=Segments+Sizes)
**Branch:** `feat/audience-search-users`

## Goal

Let an operator search for an individual user (by exact external ID, Braze ID, or email) and
see everything Nexus knows about them on one page: identity + funnel summary, pinned
properties, all raw attributes, a 30-day messaging-history timeline, bandit arm stats, and
gift history. Ship a shared `UserDetail` component so the Control Tower inspector and the new
Audience › Search Users page render the same view.

## Context

- `/audience/search` currently renders a `ComingSoon` placeholder (shipped in sub-project A).
- Control Tower already has a `UserInspector` client component with an exact-externalId search
  box that calls `GET /api/users/[externalId]`. We upgrade both surfaces to one shared view.
- Live DB scale: **34.6M users**; `attributes` is a JSON text column with ~41 sparse keys and is
  **not** indexed. `externalId` and `brazeId` are `@unique` (instant exact lookup).
- **Known risk:** Prisma's JSON-path filter (`where: { attributes: { path: ['email'], equals } }`)
  does **not** reliably use a btree expression index on `(attributes->>'email')`. Email search
  must go through `$queryRaw` with `WHERE attributes->>'email' = $1` to guarantee index usage.

## Components

### 1. `GET /api/users/search?q=` (new, session-guarded)

- `q` trimmed; empty → `400 { error }`.
- If `q` contains `@` → treat as email: `$queryRaw` exact match
  `WHERE attributes->>'email' = $1 LIMIT 25` (uses the expression index, see #2).
- Else → exact `externalId` lookup, then exact `brazeId` lookup (both `@unique`).
- Returns `{ data: SearchHit[] }`, `SearchHit = { externalId, brazeId, email, name, funnelStage, personaName }`, `LIMIT 25`.
- No match → `200 { data: [] }`.
- Uses `ok` / `fail` / `handleRouteError` from `src/lib/api/respond.ts`.

### 2. Email expression index (migration)

```sql
CREATE INDEX IF NOT EXISTS "User_attributes_email_idx" ON "User" ((attributes->>'email'));
```

- Idempotent DDL applied to **prod and test** DBs manually (NOT `prisma migrate dev` — that loads
  `.env.local` = prod).
- Create the migration folder by hand, then `prisma migrate resolve --applied <name>` on both DBs
  to reconcile migration history without re-running the DDL.
- Regression test guards the SQL column expression `attributes->>'email'` in the search route.

### 3. `GET /api/users/[externalId]` (extended)

Keep `armStats` + `gifts`. Replace `recentDecisions` with a richer `messagingHistory`. Add:

- parsed `attributes` (object)
- `funnelStage`, `funnelStageUpdatedAt`
- `timezone`, `preferredSendHour`, `preferredSendMinute`
- parsed `channelStats`
- `brazeId`, `createdAt`
- `messagingHistory`: last-30-day `UserDecision` rows expanded into event timeline entries
  (sent / open / conversion) with `channel`, `event`, `time`, `agentName`, variant `name`+`title`.

Only consumer is `UserInspector` (being refactored to `UserDetail`), so the contract can evolve
freely. JSON fields parsed/validated on read (tolerant to corrupt/missing — degrade to null/empty).

### 4. Pure lib helpers (unit-tested)

- `src/lib/users/pinned-properties.ts` — `(attributes, userFields) → { label, value }[]` in a fixed
  display order; tolerant to missing keys (skip or show "—"). No business logic in the component.
- `src/lib/users/messaging-history.ts` — `(decisions) → TimelineEvent[]`: expands each decision into
  sent/open/conversion events, sorted by time desc, within a 30-day window.

### 5. Shared `src/components/users/user-detail.tsx` (presentational, props-driven)

Sections: header summary · Pinned properties · All properties (collapsible raw table) · Messaging
history (30-day timeline) · Arm stats · Gifts. Reuses `BetaBar` (currently exported from
`user-inspector.tsx` — move/keep export accessible). No fetching inside; parent passes the detail
payload.

### 6. Pages / wiring

- `/audience/search` — replace placeholder: Server Component shell + `Header` + client `UserSearch`
  (search box → matches list → select → fetch `/api/users/[externalId]` → `<UserDetail>`).
  A single exact match auto-loads.
- Control Tower `UserInspector` — refactor to fetch + render the shared `<UserDetail>` (no
  behavior loss; gains the new sections for free).

### 7. Tests

- Integration `tests/integration/users-search.test.ts` — externalId hit, brazeId hit, email hit,
  empty `q` → 400, no match → `200 []`.
- Extend the existing detail test for the new fields (attributes, funnelStage, messagingHistory).
- Unit `tests/unit/pinned-properties.test.ts`, `tests/unit/messaging-history.test.ts` — all branches.
- Regression `tests/regression/users-email-index.test.ts` — asserts search route SQL uses
  `attributes->>'email'` (column-expression guard).
- Use `tests/helpers/builders.ts` factories.

## Out of scope

- Fuzzy / partial / prefix search (exact only — 34.6M rows, no trigram index).
- Editing user data from this page (read-only).
- Cross-user / segment views (that's sub-project C).
