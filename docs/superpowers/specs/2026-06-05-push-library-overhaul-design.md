# Push Library Overhaul + Copywriter Role — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design)

## Goal

Make the push library fully manageable by operators: server-side search, manual
editing and recategorization of every push, reorder/sort/filter on everything,
user-managed (CRUD) categories **and** subcategories, plus a new `copywriter`
role that has full push-library parity with `admin` (and nothing outside the
library).

## Decisions (locked)

1. **Taxonomy** — Both categories AND subcategories become fully user-managed,
   DB-backed CRUD. The hardcoded `push-categories.ts` validation list is retired.
2. **Nesting** — Two levels (category → subcategory), both editable. No arbitrary
   tree.
3. **Copywriter perms** — Full parity with admin *inside* the push library
   (create/edit/recategorize/delete pushes + manage taxonomy). No access outside it.
4. **Role storage** — WorkOS roles. Add `copywriter` in the WorkOS dashboard and
   read it from the session like `admin`. No DB schema or in-app role-assignment UI.

## Current state (grounding)

- **Taxonomy** lives in `src/lib/push-categories.ts` as a hardcoded
  `PUSH_CATEGORIES` array: 6 categories, 21 subcategories
  (`guided-scripture` intentionally has zero subcategories). Exports
  `PUSH_CATEGORY_VALUES`, `VALID_PUSH_CATEGORIES` (Set, used for POST validation),
  `PUSH_SUBCATEGORIES` (category → subcategory slugs).
- **MessageVariant** stores `category String?` and `subcategory String?` as free-text
  slug columns. Index `@@index([status, category, subcategory])`. **No position
  field exists** on variants today.
- **Deeplink coupling**: `subcategory === "specific-verse"` is special-cased in
  `src/components/push-library/template-form-sheet.tsx` (lines 72, 105, 249, 345)
  via `src/lib/push-deeplinks.ts` (`isSpecificVerseDeeplink`, `parseUsfmFromDeeplink`).
  This is the only taxonomy→behavior coupling. (Note: the form also special-cases
  preview values `reference/headline-a/headline-b/inverted` at line 314 — those are
  *not* taxonomy subcategories and are out of scope here.)
- **API**:
  - `GET /api/push-library` (public): selects variants under the
    `LIBRARY_AGENT_NAME` agent, `orderBy [{category asc},{subcategory asc},{createdAt asc}]`,
    groups in JS by category→subcategory. No search/sort/filter/pagination params.
  - `POST /api/push-library` (admin): validates `category` against
    `VALID_PUSH_CATEGORIES`; **subcategory is NOT validated** (just trimmed).
  - `DELETE /api/push-library/[id]` (admin): soft-delete.
  - `PATCH /api/variants/[id]` (admin): `UPDATABLE_FIELDS` whitelist includes
    `category` but **NOT `subcategory`** and **no `sortOrder`** — so subcategory
    recategorization and reorder are impossible today. Enforces push completeness
    (non-empty title + body). Syncs copy to clones when it's a library template.
  - `DELETE /api/variants/[id]` (admin): hard delete.
- **Auth** (`src/lib/auth.ts`): `getAuth()` → `{ user, isAdmin }` where
  `isAdmin = auth.roles?.includes("admin") ?? false`. `requireAdmin()` → 403 unless
  admin. Roles come from the WorkOS session, not the DB. There is no user/account
  table. The `X-User-Role` header from `api-client.ts` is advisory only — server
  authorization always reads the session.
- **UI**: `src/app/messages/page.tsx` (server, currently `isAdmin = !!user`),
  `src/components/push-library/push-library-client.tsx` (client-only search over
  name/body/title, category/subcategory pill filters, grid/table views),
  `template-form-sheet.tsx` (taxonomy from `push-categories.ts`),
  `template-card.tsx` (gates edit/delete on `isAdmin`).
  Other taxonomy consumers: `template-picker.tsx`, `variant-picker.tsx`.

## Architecture

### 1. Data model (Prisma)

Two new tables. `MessageVariant.category`/`subcategory` stay as **slug strings**
(no churn; existing index intact). **Slug is immutable; label is freely editable**
— renames never cascade to variant rows. Recategorizing a push repoints its slug to
another existing subcategory.

```prisma
model PushCategory {
  id        String   @id @default(cuid())
  slug      String   @unique          // immutable key
  label     String                    // freely editable display name
  sortOrder Int      @default(0)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  subcategories PushSubcategory[]
}

model PushSubcategory {
  id               String   @id @default(cuid())
  categoryId       String
  category         PushCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  slug             String   @unique   // globally unique (preserves deeplink keying)
  label            String
  sortOrder        Int      @default(0)
  deeplinkBehavior String   @default("none")  // "specific-verse" | "none"
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  @@index([categoryId, sortOrder])
}
```

`MessageVariant` additions:
```prisma
sortOrder Int @default(0)   // manual drag-reorder within a subcategory
@@index([category, subcategory, sortOrder])
```

### 2. Taxonomy migration & caching

- **Additive migration only** (no drops → deploy-order safe): `CREATE TABLE IF NOT
  EXISTS` for both tables, `ADD COLUMN IF NOT EXISTS "sortOrder"` on `MessageVariant`,
  add the new index.
- **Seed in the same migration**: import the current 6 categories / 21 subcategories
  from `push-categories.ts`, preserving slugs, labels, and order (sortOrder = array
  index). Set `deeplinkBehavior = 'specific-verse'` on the `specific-verse`
  subcategory; `'none'` elsewhere.
- **Cached accessor** `getPushTaxonomy()` in `src/lib/cache/` (`unstable_cache` +
  React `cache()`, tag `"push-taxonomy"`, TTL = `TTL.DAY`). Returns categories with
  nested active subcategories, ordered by sortOrder. All taxonomy mutations call
  `revalidateTag("push-taxonomy")`.
- **`push-categories.ts` is retired as a runtime source**: it keeps only the typed
  `deeplinkBehavior` union and (optionally) a static copy used solely by the seed
  migration. Validation and UI now read `getPushTaxonomy()`.
- **Deeplink coupling** moves from `subcategory === "specific-verse"` to looking up
  the subcategory's `deeplinkBehavior === "specific-verse"`. A small pure helper
  `subcategoryHasVerseDeeplink(slug, taxonomy)` replaces the hardcoded string
  comparison in the form and any server path.

### 3. API surface

All push-library mutations switch from `requireAdmin()` → `requireLibraryEditor()`.
Response contract unchanged: `{ data: T }` / `{ error: string }`.

**Taxonomy (new):**
- `GET /api/push-library/categories` (public) → categories + nested active
  subcategories, ordered by sortOrder. Backed by `getPushTaxonomy()`.
- `POST /api/push-library/categories` (editor) → `{ label, slug? }`. Slug
  auto-derived from label if omitted; validated unique; 409 on collision.
- `PATCH /api/push-library/categories/[id]` (editor) → `label`, `sortOrder`,
  `isActive`. (Slug immutable.)
- `DELETE /api/push-library/categories/[id]` (editor) → soft-delete (`isActive=false`).
  Hard delete blocked (`onDelete: Restrict`) when it has subcategories; return 409
  with a clear message.
- `POST /api/push-library/subcategories` (editor) → `{ categoryId, label, slug?,
  deeplinkBehavior? }`. Slug auto-derived + globally unique.
- `PATCH /api/push-library/subcategories/[id]` (editor) → `label`, `sortOrder`,
  `isActive`, `deeplinkBehavior`, and `categoryId` (move to another category).
- `DELETE /api/push-library/subcategories/[id]` (editor) → soft-delete; if any
  variant still references its slug, return 409 (force the operator to recategorize
  first) — or soft-delete and surface the orphan count. **Decision: soft-delete +
  block when in use** (consistent, no silent orphans).

**Items (enhance existing):**
- `GET /api/push-library` gains query params: `q` (server-side ILIKE over
  name/title/subject/body/cta), `category`, `subcategory`, `status`, `sort`
  (`createdAt|name|sortOrder|category`, with direction), and cursor pagination.
  Returns `{ data: { items, total, nextCursor } }`. Default sort preserves today's
  behavior (category, subcategory, sortOrder, createdAt).
- `PATCH /api/variants/[id]`: add `subcategory` and `sortOrder` to
  `UPDATABLE_FIELDS`. Validate `category`/`subcategory` against the taxonomy
  (must exist + be active; subcategory must belong to the chosen category) before
  the DB write — reject with 400 on mismatch. Keep existing push-completeness check.
- `POST /api/push-library/reorder` (editor) → `{ ids: string[] }` (ordered) scoped
  to one subcategory; writes contiguous `sortOrder` values in a transaction.
- `POST /api/push-library/bulk` (editor) → `{ ids: string[], op: "recategorize" |
  "setStatus" | "delete", … }` for bulk recategorize / status change / soft-delete.

### 4. Copywriter role (WorkOS)

- Add `copywriter` role in the WorkOS dashboard (operational step, documented in
  the plan).
- `src/lib/auth.ts`:
  - `getAuth()` returns `{ user, isAdmin, isCopywriter, canManageLibrary }` where
    `isCopywriter = roles.includes("copywriter")` and
    `canManageLibrary = isAdmin || isCopywriter`.
  - New `requireLibraryEditor()` → 403 unless `canManageLibrary`.
- Apply `requireLibraryEditor()` to: categories CRUD, subcategories CRUD,
  `/api/push-library` POST, `/api/push-library/[id]` DELETE, `/api/variants/[id]`
  PATCH + DELETE, reorder, bulk.
- Everything **outside** the library keeps `requireAdmin()`: agents
  (POST/PATCH/DELETE), per-agent messages (POST/PUT), personas, settings.
- Authorization always derives from the WorkOS session in `getAuth()`. The
  `X-User-Role` header stays advisory and is never trusted for authz.

### 5. UI

- `messages/page.tsx`: pass `canManageLibrary` (from `getAuth()`) instead of
  `isAdmin = !!user`; fetch initial taxonomy via `getPushTaxonomy()`.
- `push-library-client.tsx`: replace client-only search with debounced
  server-driven query (`GET /api/push-library?q=&category=&subcategory=&status=&sort=`);
  add a sort dropdown and status filter; filter pills sourced from the taxonomy API;
  drag-to-reorder within a subcategory, persisted via `/reorder`. Prop renamed
  `isAdmin` → `canManageLibrary`. Bulk-select toolbar (recategorize/status/delete)
  gated by `canManageLibrary`.
- New **Manage Categories** sheet: CRUD + reorder for categories and subcategories,
  edit `deeplinkBehavior`, gated by `canManageLibrary`.
- `template-form-sheet.tsx`: category/subcategory selects populated from taxonomy
  API (not `push-categories.ts`); inline "create subcategory"; specific-verse deeplink
  UI driven by the selected subcategory's `deeplinkBehavior`.
- `template-card.tsx`, `template-picker.tsx`, `variant-picker.tsx`: read taxonomy
  from the API/`getPushTaxonomy()` and gate controls on `canManageLibrary`.

## Error handling

- Slug collisions → 409 with a clear message (never a raw Prisma error).
- Deleting an in-use category/subcategory → 409 listing what must be reassigned.
- Invalid category/subcategory on variant PATCH/POST → 400 before any DB write.
- All routes keep the project contract: log server-side, return generic strings.

## Testing

- **Unit** (`tests/unit/`): taxonomy validation helper (exists + active + belongs to
  category); `subcategoryHasVerseDeeplink` resolution by `deeplinkBehavior`; slug
  derivation + immutability.
- **Integration** (`tests/integration/`): categories CRUD, subcategories CRUD
  (incl. move + deeplinkBehavior), in-use delete → 409, reorder persistence, bulk
  ops, `GET /api/push-library` search/sort/filter/pagination, variant PATCH
  recategorizing both levels + invalid-taxonomy 400.
- **Regression** (`tests/regression/`): copywriter can mutate the library but gets
  403 on agents/personas/settings; admin retains all; `specific-verse` deeplink
  still resolves after migration; seed imports exactly 6 categories / 21
  subcategories with correct slugs/order; default `GET /api/push-library` ordering
  unchanged.
- **Auth**: `requireLibraryEditor()` returns 403 for non-admin/non-copywriter,
  null otherwise.

## Implementation phasing (for the plan)

1. **Schema + migration + seed + `getPushTaxonomy()`** (additive, safe deploy order).
2. **Taxonomy API + caching + deeplinkBehavior migration** (retire
   `VALID_PUSH_CATEGORIES` runtime use; rewire form/pickers to the API).
3. **Role wiring** (`getAuth` fields, `requireLibraryEditor`, swap on library routes).
4. **Item search/sort/filter/pagination + reorder + bulk + variant PATCH
   (subcategory/sortOrder) + UI** (server-driven search, manage-categories sheet,
   bulk toolbar, drag-reorder).

## Out of scope

- Arbitrary-depth nesting.
- In-app role assignment / a DB user table.
- The form's `reference/headline-a/headline-b/inverted` preview special-case
  (unrelated to taxonomy).
- Changing per-agent message management or any non-library surface.
