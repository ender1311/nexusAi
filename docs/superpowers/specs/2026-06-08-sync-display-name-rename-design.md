# Sync Display-Name Rename Design

**Goal:** Let admins give a Hightouch sync a custom, DB-backed display name (keyed by sync id) that surfaces everywhere the sync is shown, while never affecting how syncs are triggered.

**Status:** Approved — ready for implementation planning.

---

## Background

The Data Ingest page lists Hightouch syncs (`/data-ingest`, Syncs tab). Each sync's
shown name is resolved by `syncDisplayName(sync)` in the client component
`src/components/data-ingest/syncs-table.tsx`, with this precedence:

1. A static override from `src/lib/hightouch/sync-name-overrides.json`
   (currently `{ "2770929": "Push Opens" }`), imported at module load.
2. `sync.name` (trimmed).
3. A humanized version of `sync.slug` (`humanizeSlug`, with an `ABBREVS` set
   that upper-cases tokens like `wau`/`mau`/`yv`).

Editing a name today means editing the JSON file and redeploying. Triggering is
done purely by sync id (`client.triggerSync(id)` in
`src/app/api/hightouch/syncs/[id]/trigger/route.ts`); the display name is never
part of triggering, so the "rename never affects triggering" invariant already
holds and must be preserved.

This feature replaces the static JSON with a DB-backed, admin-editable override
that can be set/cleared inline in the syncs table.

## Non-goals

- No change to triggering, scheduling, or any Hightouch API call. Renames are
  display-only.
- No rename of models, destinations, or sources — syncs only.
- No bulk-edit UI. One sync at a time, inline.
- No history/audit of past names beyond `updatedAt`.

---

## Architecture

A new `SyncNameOverride` Prisma model keyed by `syncId` stores `id → displayName`.
Overrides are read server-side on the (already `force-dynamic`) Data Ingest page
and passed to the client `SyncsTable` as an `overrides: Record<string, string>`
prop. Name resolution moves out of the client component into a tested pure helper.
Writes go through an admin-gated REST endpoint following the repo's
`{ data } | { error }` envelope convention. Inline edit in the table mutates via
that endpoint, then optimistically updates local state and calls
`router.refresh()` so the server-rendered override map re-reads.

### Components / files

- **Create** `prisma` model `SyncNameOverride` (schema + idempotent migration).
- **Create** `src/lib/hightouch/sync-display-name.ts` — pure resolver + helpers.
- **Create** `src/app/api/hightouch/syncs/[id]/name/route.ts` — `PUT` + `DELETE`.
- **Modify** `src/app/data-ingest/page.tsx` — add `getCachedOverrides()`, thread
  the map into `SyncsSection` → `SyncsTable`.
- **Modify** `src/components/data-ingest/syncs-table.tsx` — accept `overrides`
  prop, use the lib resolver, add inline edit affordance to `SyncCard` and
  `SyncTableRow`.
- **Create** `src/components/data-ingest/sync-name-edit.tsx` — small client
  inline-edit control (input + save/cancel/reset) used by both row variants.
- **Delete** `src/lib/hightouch/sync-name-overrides.json` and its import.

---

## Data model

```prisma
model SyncNameOverride {
  syncId      String   @id            // Hightouch sync id (stringified)
  displayName String                  // trimmed, 1–100 chars
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
}
```

`syncId` is the primary key, so the table is a pure id→name map; an upsert by
`syncId` is the natural write.

### Migration (production-safe)

Per repo rules, never run `prisma migrate dev`/`db push` (they load `.env.local`
= prod and may reset). Instead:

1. Add the model to `schema.prisma`.
2. Create a migration folder `prisma/migrations/<timestamp>_add_sync_name_override/migration.sql`
   with idempotent DDL:
   ```sql
   CREATE TABLE IF NOT EXISTS "SyncNameOverride" (
     "syncId"      TEXT NOT NULL,
     "displayName" TEXT NOT NULL,
     "updatedAt"   TIMESTAMP(3) NOT NULL,
     "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "SyncNameOverride_pkey" PRIMARY KEY ("syncId")
   );
   -- Seed the one existing JSON override.
   INSERT INTO "SyncNameOverride" ("syncId", "displayName", "updatedAt", "createdAt")
   VALUES ('2770929', 'Push Opens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT ("syncId") DO NOTHING;
   ```
3. Apply the DDL to the local test DB and to prod (`DATABASE_URL_UNPOOLED` from
   `.env.local`) manually.
4. `prisma migrate resolve --applied <migration>` to reconcile history without
   re-running DDL.
5. `npx prisma generate`, then revert any `apps/api/src/generated/prisma/` churn
   with `git checkout --`.

After the migration is applied, delete `sync-name-overrides.json` and its import.

---

## Name resolution helper

`src/lib/hightouch/sync-display-name.ts`:

```ts
import type { HightouchSync } from "@/lib/hightouch/types";

const ABBREVS = new Set(["wau", "mau", "dau", "ba", "en", "us", "uk", "id", "yv"]);

export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (ABBREVS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function syncDisplayName(sync: HightouchSync, overrides: Record<string, string>): string {
  const override = overrides[String(sync.id)];
  if (override) return override;
  return sync.name?.trim() || humanizeSlug(sync.slug);
}
```

Precedence after this change: **DB override → `sync.name` → humanized slug**
(the JSON layer is removed). `humanizeSlug` and `ABBREVS` are deleted from
`syncs-table.tsx` and imported from here.

---

## Server data flow

In `src/app/data-ingest/page.tsx`, add a React.cache wrapper that reads overrides
directly via Prisma and returns a plain map:

```ts
import { prisma } from "@/lib/db";

const getCachedOverrides = cache(async (): Promise<Record<string, string>> => {
  const rows = await prisma.syncNameOverride.findMany({
    select: { syncId: true, displayName: true },
  });
  return Object.fromEntries(rows.map((r) => [r.syncId, r.displayName]));
});
```

`SyncsSection` awaits it alongside the existing fetches and passes `overrides`
into `SyncsTable`. The page is already `export const dynamic = "force-dynamic"`,
so each request re-reads the map; combined with `router.refresh()` after an edit,
the rendered name updates without a hard reload.

---

## Mutation endpoint

`src/app/api/hightouch/syncs/[id]/name/route.ts`, both handlers behind
`requireAdmin()` (consistent with the other Hightouch routes):

- **`PUT`** body `{ displayName: string }`:
  - Validate **before** any DB access: must be a string; `trim()` it; reject
    empty or `> 100` chars with `400 { error }`.
  - `prisma.syncNameOverride.upsert({ where: { syncId }, create, update })`.
  - Return `200 { data: { syncId, displayName } }`.
- **`DELETE`**:
  - `prisma.syncNameOverride.deleteMany({ where: { syncId } })` (idempotent — no
    404 if absent).
  - Return `200 { data: { syncId } }`.

No Prisma error messages are surfaced; unexpected throws map to a generic
`500 { error }`. `syncId` comes from the route param (string), so it pairs with
any Hightouch sync id without a separate existence check.

---

## Inline edit UX

`src/components/data-ingest/sync-name-edit.tsx` (client) renders, given the
current `syncId` and `displayName`:

- A default state: the name plus a small pencil button (`lucide-react` `Pencil`,
  `h-3 w-3`, muted) revealed on hover/focus.
- An editing state: a compact `Input` pre-filled with the current name, a save
  button (`Check`), a cancel button (`X`), and — when an override currently
  exists — a reset control ("Reset to default") that issues `DELETE`.
- Behavior:
  - Save → `PUT`; on success, optimistically set local state to the new name and
    call `router.refresh()`.
  - Reset → `DELETE`; optimistically fall back to the computed default
    (`sync.name`/slug) and `router.refresh()`.
  - Empty input + save is treated as reset (DELETE), so clearing the field
    reverts to the default.
  - Disable controls while the request is in flight; on error, keep edit mode
    open and show an inline error message (no toast dependency required).
- Helper text in the editing state: "Display-only — does not affect sync
  triggering."

Both `SyncCard` (mobile) and `SyncTableRow` (desktop) replace their inline
`{displayName}` render with `<SyncNameEdit syncId={String(sync.id)} displayName={displayName} />`.
The `TriggerSyncButton` continues to receive `syncId={sync.id}` and is never
coupled to the display name.

### Search & sort

`SyncsTable` already uses `syncDisplayName` for search matching and name sort;
those call sites switch to the lib helper with the `overrides` prop. No behavior
change beyond the override source moving to the DB.

---

## Error handling

- **Validation**: empty / non-string / `> 100` chars → `400 { error }` before DB.
- **Auth**: non-admin → the `requireAdmin()` 401/403 response.
- **Unexpected**: caught, logged server-side, returned as generic `500 { error }`;
  no Prisma detail leaked.
- **Client**: failed mutation keeps the editor open with an inline error; the
  optimistic update is only applied after a successful response.

---

## Testing

- **Unit** `tests/unit/sync-display-name.test.ts`:
  - override present → returns override.
  - no override, `sync.name` present → returns trimmed `sync.name`.
  - no override, no name → returns `humanizeSlug(slug)`.
  - abbreviation casing (e.g. `push-opens-wau` → `Push Opens WAU`).
- **Integration** `tests/integration/sync-name-override.test.ts`:
  - `PUT` creates an override and returns `{ data: { syncId, displayName } }`.
  - `PUT` on an existing `syncId` updates it (upsert).
  - `PUT` with empty / whitespace-only / `> 100` char name → `400`.
  - `DELETE` removes the override and returns `{ data: { syncId } }`; `DELETE`
    when none exists still `200` (idempotent).
  - (Auth is exercised via the standard mocked-admin harness; a non-admin path
    asserts the `requireAdmin` rejection if the harness supports toggling it.)
- **Regression** `tests/regression/sync-rename-does-not-affect-trigger.test.ts`:
  - After setting an override for a sync id, triggering that sync still calls the
    Hightouch client's `triggerSync` with the original `sync.id` (the rename
    never reaches the trigger path). Bug-link comment references this spec.

Run `bun run test:quick` while iterating and `bun run check` before the MR.

---

## Rollout

1. Schema + idempotent migration applied to test DB and prod; `migrate resolve --applied`.
2. Code deploy (resolver helper, endpoint, page wiring, inline edit, JSON delete).
   The seed runs in the migration, so `2770929 → "Push Opens"` survives the JSON
   removal.
3. No env vars or feature flags required.
