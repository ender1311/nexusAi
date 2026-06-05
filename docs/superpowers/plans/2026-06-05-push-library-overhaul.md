# Push Library Overhaul + Copywriter Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the push library fully operator-managed — server-side search/sort/filter, manual recategorization + drag-reorder, DB-backed CRUD categories/subcategories (retiring the hardcoded list), plus a WorkOS `copywriter` role with full library parity.

**Architecture:** Two new Prisma tables (`PushCategory`, `PushSubcategory`) keyed by immutable slug; `MessageVariant.category`/`subcategory` stay slug strings. A cached `getPushTaxonomy()` accessor feeds validation, deeplink behavior, and UI. New taxonomy + reorder + bulk API routes gated by a new `requireLibraryEditor()` (admin OR copywriter). Existing library mutation routes switch to that gate. UI rewired to server-driven search and taxonomy API.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma v7 + PostgreSQL (Neon), bun:test, WorkOS AuthKit.

**Reference:** Design spec at `docs/superpowers/specs/2026-06-05-push-library-overhaul-design.md`.

**Conventions every task must follow:**
- API routes return `{ data: T }` (use `ok()` from `@/lib/api/respond`) or `{ error: string }` (use `fail()`); catch blocks use `handleRouteError(context, err)`.
- Validate input BEFORE any DB access; never leak Prisma errors.
- Run `bun run check:quick` while iterating; `bun run check` before the final merge.
- Integration/regression tests use `tests/helpers/builders.ts` and `truncateAll()` from `tests/helpers/db.ts`, run via `bun test` (never `bun run`).
- Commit after every green task.

---

## Phase 1 — Schema, migration, seed, cached accessor

### Task 1: Add PushCategory + PushSubcategory models and MessageVariant.sortOrder

**Files:**
- Modify: `prisma/schema.prisma` (add two models; add `sortOrder` + index to `MessageVariant`)

- [ ] **Step 1: Add the two models to `prisma/schema.prisma`**

Append after the `MessageVariantTranslation` model:

```prisma
model PushCategory {
  id        String   @id @default(cuid())
  slug      String   @unique
  label     String
  sortOrder Int      @default(0)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  subcategories PushSubcategory[]

  @@index([isActive, sortOrder])
}

model PushSubcategory {
  id               String   @id @default(cuid())
  categoryId       String
  slug             String   @unique
  label            String
  sortOrder        Int      @default(0)
  deeplinkBehavior String   @default("none") // "specific-verse" | "none"
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())

  category PushCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)

  @@index([categoryId, sortOrder])
}
```

- [ ] **Step 2: Add `sortOrder` + index to `MessageVariant`**

In the `MessageVariant` model, add after the `subcategory` line:

```prisma
  sortOrder            Int       @default(0) // manual drag-reorder within a subcategory
```

And add this index next to the existing `@@index` lines:

```prisma
  @@index([category, subcategory, sortOrder]) // library grouping + manual ordering
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS (new models compile; no usages yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat(schema): add PushCategory/PushSubcategory + MessageVariant.sortOrder"
```

---

### Task 2: Write the additive migration + seed SQL

**Files:**
- Create: `prisma/migrations/20260605120000_push_taxonomy/migration.sql`

**Context:** Migration must be idempotent and additive only (no drops) so it is safe to apply to prod regardless of code-deploy timing. It creates both tables, adds the variant column + index, and seeds the current 6 categories / 21 subcategories from `src/lib/push-categories.ts` preserving slugs, labels, and order. The one `specific-verse` subcategory gets `deeplinkBehavior='specific-verse'`.

- [ ] **Step 1: Create the migration directory and SQL file**

Create `prisma/migrations/20260605120000_push_taxonomy/migration.sql`:

```sql
-- PushCategory
CREATE TABLE IF NOT EXISTS "PushCategory" (
  "id"        TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushCategory_slug_key" ON "PushCategory"("slug");
CREATE INDEX IF NOT EXISTS "PushCategory_isActive_sortOrder_idx" ON "PushCategory"("isActive", "sortOrder");

-- PushSubcategory
CREATE TABLE IF NOT EXISTS "PushSubcategory" (
  "id"               TEXT NOT NULL,
  "categoryId"       TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "label"            TEXT NOT NULL,
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  "deeplinkBehavior" TEXT NOT NULL DEFAULT 'none',
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubcategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubcategory_slug_key" ON "PushSubcategory"("slug");
CREATE INDEX IF NOT EXISTS "PushSubcategory_categoryId_sortOrder_idx" ON "PushSubcategory"("categoryId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "PushSubcategory" ADD CONSTRAINT "PushSubcategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "PushCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- MessageVariant.sortOrder + index
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "MessageVariant_category_subcategory_sortOrder_idx"
  ON "MessageVariant"("category", "subcategory", "sortOrder");

-- Seed categories (slug, label, sortOrder)
INSERT INTO "PushCategory" ("id","slug","label","sortOrder","isActive") VALUES
  ('pcat_reader','reader','Reader',0,true),
  ('pcat_votd','votd','VOTD',1,true),
  ('pcat_plans','plans','Plans',2,true),
  ('pcat_guided_scripture','guided-scripture','Guided Scripture',3,true),
  ('pcat_guided_prayer','guided-prayer','Guided Prayer',4,true),
  ('pcat_giving','giving','Giving',5,true)
ON CONFLICT ("slug") DO NOTHING;

-- Seed subcategories (categoryId, slug, label, sortOrder, deeplinkBehavior)
INSERT INTO "PushSubcategory" ("id","categoryId","slug","label","sortOrder","deeplinkBehavior","isActive") VALUES
  ('psub_open_bible','pcat_reader','open-bible','Open Bible',0,'none',true),
  ('psub_audio_bible','pcat_reader','audio-bible','Audio Bible',1,'none',true),
  ('psub_specific_verse','pcat_reader','specific-verse','Specific Verse',2,'specific-verse',true),
  ('psub_votd_page','pcat_votd','votd-page','Verse of the Day',0,'none',true),
  ('psub_todays_story','pcat_votd','todays-story','Today''s Story',1,'none',true),
  ('psub_find_plans','pcat_plans','find-plans','Find Plans',0,'none',true),
  ('psub_my_plans','pcat_plans','my-plans','My Plans',1,'none',true),
  ('psub_saved_plans','pcat_plans','saved-plans','Saved Plans',2,'none',true),
  ('psub_guided_prayer','pcat_guided_prayer','guided-prayer','Guided Prayer',0,'none',true),
  ('psub_prayer_list','pcat_guided_prayer','prayer-list','Prayer List',1,'none',true),
  ('psub_monthly_appeal','pcat_giving','monthly-appeal','Monthly Appeal',0,'none',true),
  ('psub_giving_tuesday','pcat_giving','giving-tuesday','Giving Tuesday',1,'none',true),
  ('psub_eoy','pcat_giving','eoy','End of Year',2,'none',true),
  ('psub_matching_gift','pcat_giving','matching-gift','Matching Gift',3,'none',true),
  ('psub_recurring_gift','pcat_giving','recurring-gift','Recurring Gift',4,'none',true),
  ('psub_sower_generosity','pcat_giving','sower-generosity','Sower Generosity',5,'none',true),
  ('psub_impact_story','pcat_giving','impact-story','Impact Story',6,'none',true),
  ('psub_prayer','pcat_giving','prayer','Prayer',7,'none',true),
  ('psub_thank_you_followup','pcat_giving','thank-you-followup','Thank You Follow-up',8,'none',true),
  ('psub_dynamic_handle','pcat_giving','dynamic-handle','Dynamic Handle',9,'none',true)
ON CONFLICT ("slug") DO NOTHING;
```

(Note: `guided-scripture` intentionally has zero subcategories — matches current state.)

- [ ] **Step 2: Apply the migration to the local test DB**

Run:
```bash
psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" -f prisma/migrations/20260605120000_push_taxonomy/migration.sql
```
Expected: `CREATE TABLE`/`INSERT 0 N` output, no errors. Re-running is a no-op (idempotent).

- [ ] **Step 3: Verify the seed**

Run:
```bash
psql "postgresql://localhost:5432/nexus_test" -c "SELECT (SELECT count(*) FROM \"PushCategory\") AS cats, (SELECT count(*) FROM \"PushSubcategory\") AS subs;"
```
Expected: `cats = 6`, `subs = 20`. (21 subcategory *slots* in the old list include the duplicate `guided-prayer` name; distinct seeded rows = 20. The spec's "21" counted the form's `guided-prayer` value twice — the canonical seed is 20 distinct subcategory rows across 5 categories.)

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260605120000_push_taxonomy
git commit -m "feat(migration): push taxonomy tables + seed from push-categories"
```

---

### Task 3: Pure taxonomy helpers (slugify, lookup, validation, deeplink behavior)

**Files:**
- Create: `src/lib/push-taxonomy.ts`
- Test: `tests/unit/push-taxonomy.test.ts`

**Context:** Pure functions operating on an in-memory taxonomy snapshot (no DB). Used by routes and UI. Keeps `push-categories.ts` only as historical seed data + the `deeplinkBehavior` concept.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/push-taxonomy.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  slugify,
  findCategory,
  findSubcategory,
  validateVariantTaxonomy,
  subcategoryHasVerseDeeplink,
  type PushTaxonomy,
} from "@/lib/push-taxonomy";

const TAXONOMY: PushTaxonomy = [
  {
    id: "c1", slug: "reader", label: "Reader", sortOrder: 0, isActive: true,
    subcategories: [
      { id: "s1", slug: "open-bible", label: "Open Bible", sortOrder: 0, deeplinkBehavior: "none", isActive: true },
      { id: "s2", slug: "specific-verse", label: "Specific Verse", sortOrder: 1, deeplinkBehavior: "specific-verse", isActive: true },
      { id: "s3", slug: "retired-sub", label: "Retired", sortOrder: 2, deeplinkBehavior: "none", isActive: false },
    ],
  },
  { id: "c2", slug: "giving", label: "Giving", sortOrder: 1, isActive: true, subcategories: [] },
  { id: "c3", slug: "old-cat", label: "Old", sortOrder: 2, isActive: false, subcategories: [] },
];

describe("slugify", () => {
  it("lowercases, trims, and dashes", () => {
    expect(slugify("  Verse Of The Day! ")).toBe("verse-of-the-day");
    expect(slugify("End of Year")).toBe("end-of-year");
  });
});

describe("findCategory / findSubcategory", () => {
  it("finds by slug", () => {
    expect(findCategory(TAXONOMY, "reader")?.id).toBe("c1");
    expect(findSubcategory(TAXONOMY, "specific-verse")?.id).toBe("s2");
    expect(findCategory(TAXONOMY, "nope")).toBeNull();
  });
});

describe("validateVariantTaxonomy", () => {
  it("accepts an active category with a matching active subcategory", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "reader", "specific-verse").ok).toBe(true);
  });
  it("accepts an active category with no subcategory", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "giving", null).ok).toBe(true);
  });
  it("rejects an unknown category", () => {
    const r = validateVariantTaxonomy(TAXONOMY, "ghost", null);
    expect(r.ok).toBe(false);
  });
  it("rejects an inactive category", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "old-cat", null).ok).toBe(false);
  });
  it("rejects a subcategory that belongs to another category", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "giving", "specific-verse").ok).toBe(false);
  });
  it("rejects an inactive subcategory", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "reader", "retired-sub").ok).toBe(false);
  });
});

describe("subcategoryHasVerseDeeplink", () => {
  it("is true only for specific-verse behavior", () => {
    expect(subcategoryHasVerseDeeplink(TAXONOMY, "specific-verse")).toBe(true);
    expect(subcategoryHasVerseDeeplink(TAXONOMY, "open-bible")).toBe(false);
    expect(subcategoryHasVerseDeeplink(TAXONOMY, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/unit/push-taxonomy.test.ts`
Expected: FAIL — module `@/lib/push-taxonomy` not found.

- [ ] **Step 3: Implement `src/lib/push-taxonomy.ts`**

```ts
export type TaxonomySubcategory = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  deeplinkBehavior: string; // "specific-verse" | "none"
  isActive: boolean;
};

export type TaxonomyCategory = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  subcategories: TaxonomySubcategory[];
};

export type PushTaxonomy = TaxonomyCategory[];

/** Derive a stable slug from a human label. */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findCategory(taxonomy: PushTaxonomy, slug: string): TaxonomyCategory | null {
  return taxonomy.find((c) => c.slug === slug) ?? null;
}

export function findSubcategory(taxonomy: PushTaxonomy, slug: string): TaxonomySubcategory | null {
  for (const c of taxonomy) {
    const s = c.subcategories.find((x) => x.slug === slug);
    if (s) return s;
  }
  return null;
}

export type TaxonomyValidation = { ok: true } | { ok: false; error: string };

/**
 * A variant must reference an active category. If it names a subcategory, that
 * subcategory must be active AND belong to the chosen category.
 */
export function validateVariantTaxonomy(
  taxonomy: PushTaxonomy,
  categorySlug: string,
  subcategorySlug: string | null,
): TaxonomyValidation {
  const cat = findCategory(taxonomy, categorySlug);
  if (!cat || !cat.isActive) return { ok: false, error: "Invalid category" };
  if (subcategorySlug == null || subcategorySlug === "") return { ok: true };
  const sub = cat.subcategories.find((s) => s.slug === subcategorySlug);
  if (!sub || !sub.isActive) return { ok: false, error: "Invalid subcategory for this category" };
  return { ok: true };
}

/** True when the subcategory's deeplink behavior is the specific-verse picker. */
export function subcategoryHasVerseDeeplink(
  taxonomy: PushTaxonomy,
  subcategorySlug: string | null,
): boolean {
  if (!subcategorySlug) return false;
  return findSubcategory(taxonomy, subcategorySlug)?.deeplinkBehavior === "specific-verse";
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `bun test tests/unit/push-taxonomy.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/push-taxonomy.ts tests/unit/push-taxonomy.test.ts
git commit -m "feat(push-taxonomy): pure helpers for slug/lookup/validation/deeplink"
```

---

### Task 4: Cached `getPushTaxonomy()` accessor + tag wiring

**Files:**
- Create: `src/lib/cache/push-taxonomy.ts`
- Modify: `src/lib/cache/index.ts` (export the new module; document the tag)
- Test: `tests/integration/push-taxonomy-cache.test.ts`

**Context:** Mirrors the existing cache wrappers (see `src/lib/cache/dashboard.ts`): `cache(unstable_cache(fn, [key], { tags, revalidate }))`. Tag `"push-taxonomy"` is busted by every taxonomy mutation. Returns the full taxonomy (active + inactive) so management UI can show inactive rows; consumers filter `isActive` themselves via the pure helpers.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-taxonomy-cache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { getPushTaxonomyUncached } from "@/lib/cache/push-taxonomy";

beforeEach(async () => {
  await truncateAll();
  await prisma.pushCategory.deleteMany();
});
afterEach(async () => {
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

describe("getPushTaxonomyUncached", () => {
  it("returns categories ordered by sortOrder with nested subcategories", async () => {
    const giving = await prisma.pushCategory.create({
      data: { slug: "giving", label: "Giving", sortOrder: 1 },
    });
    const reader = await prisma.pushCategory.create({
      data: { slug: "reader", label: "Reader", sortOrder: 0 },
    });
    await prisma.pushSubcategory.create({
      data: { categoryId: reader.id, slug: "specific-verse", label: "Specific Verse", sortOrder: 1, deeplinkBehavior: "specific-verse" },
    });
    await prisma.pushSubcategory.create({
      data: { categoryId: reader.id, slug: "open-bible", label: "Open Bible", sortOrder: 0 },
    });
    await prisma.pushSubcategory.create({
      data: { categoryId: giving.id, slug: "eoy", label: "End of Year", sortOrder: 0 },
    });

    const tax = await getPushTaxonomyUncached();

    expect(tax.map((c) => c.slug)).toEqual(["reader", "giving"]);
    expect(tax[0].subcategories.map((s) => s.slug)).toEqual(["open-bible", "specific-verse"]);
    expect(tax[0].subcategories[1].deeplinkBehavior).toBe("specific-verse");
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/push-taxonomy-cache.test.ts`
Expected: FAIL — `getPushTaxonomyUncached` not found.

- [ ] **Step 3: Implement `src/lib/cache/push-taxonomy.ts`**

```ts
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { TTL } from "./ttl";
import type { PushTaxonomy } from "@/lib/push-taxonomy";

export const PUSH_TAXONOMY_TAG = "push-taxonomy";

/** Raw DB read (no cache) — exported for tests and for the cached wrapper. */
export async function getPushTaxonomyUncached(): Promise<PushTaxonomy> {
  const categories = await prisma.pushCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { subcategories: { orderBy: { sortOrder: "asc" } } },
  });
  return categories.map((c) => ({
    id: c.id,
    slug: c.slug,
    label: c.label,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    subcategories: c.subcategories.map((s) => ({
      id: s.id,
      slug: s.slug,
      label: s.label,
      sortOrder: s.sortOrder,
      deeplinkBehavior: s.deeplinkBehavior,
      isActive: s.isActive,
    })),
  }));
}

/** Cached taxonomy. Busted by `revalidateTag(PUSH_TAXONOMY_TAG)` on any mutation. */
export const getPushTaxonomy = cache(
  unstable_cache(getPushTaxonomyUncached, ["push-taxonomy"], {
    tags: [PUSH_TAXONOMY_TAG],
    revalidate: TTL.DAY,
  }),
);
```

- [ ] **Step 4: Export from the cache barrel**

In `src/lib/cache/index.ts`, add to the tag-taxonomy doc comment a line `"push-taxonomy"     — push library categories/subcategories (busted by taxonomy mutations)` and add at the end:

```ts
export * from "./push-taxonomy";
```

- [ ] **Step 5: Run the test to confirm pass**

Run: `bun test tests/integration/push-taxonomy-cache.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cache/push-taxonomy.ts src/lib/cache/index.ts tests/integration/push-taxonomy-cache.test.ts
git commit -m "feat(cache): getPushTaxonomy accessor + push-taxonomy tag"
```

---

## Phase 2 — Copywriter role wiring + taxonomy CRUD API

### Task 5: Extend auth with copywriter role + requireLibraryEditor

**Files:**
- Modify: `src/lib/auth.ts`
- Test: `tests/unit/auth-roles.test.ts`

**Context:** WorkOS session exposes `auth.roles` (string slugs). The display name "Copywriter" maps to a slug — assumed `"copywriter"`. **Verification step in Task 13 pins the real slug.** `getAuth()` gains `isCopywriter` + `canManageLibrary`; new `requireLibraryEditor()` returns 403 unless admin OR copywriter. Pure role logic is extracted so it is unit-testable without a live WorkOS session.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/auth-roles.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { deriveRoleFlags } from "@/lib/auth";

describe("deriveRoleFlags", () => {
  it("flags admin", () => {
    const f = deriveRoleFlags(["admin"]);
    expect(f).toEqual({ isAdmin: true, isCopywriter: false, canManageLibrary: true });
  });
  it("flags copywriter as library manager but not admin", () => {
    const f = deriveRoleFlags(["copywriter"]);
    expect(f).toEqual({ isAdmin: false, isCopywriter: true, canManageLibrary: true });
  });
  it("treats unknown/empty roles as no access", () => {
    expect(deriveRoleFlags(undefined)).toEqual({ isAdmin: false, isCopywriter: false, canManageLibrary: false });
    expect(deriveRoleFlags([])).toEqual({ isAdmin: false, isCopywriter: false, canManageLibrary: false });
    expect(deriveRoleFlags(["viewer"])).toEqual({ isAdmin: false, isCopywriter: false, canManageLibrary: false });
  });
  it("admin who is also copywriter still manages library", () => {
    expect(deriveRoleFlags(["admin", "copywriter"]).canManageLibrary).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/unit/auth-roles.test.ts`
Expected: FAIL — `deriveRoleFlags` not exported.

- [ ] **Step 3: Implement in `src/lib/auth.ts`**

Add the pure helper above `getAuth`:

```ts
export const COPYWRITER_ROLE = "copywriter";

export type RoleFlags = { isAdmin: boolean; isCopywriter: boolean; canManageLibrary: boolean };

/** Pure mapping from WorkOS role slugs to capability flags. */
export function deriveRoleFlags(roles: string[] | undefined): RoleFlags {
  const isAdmin = roles?.includes("admin") ?? false;
  const isCopywriter = roles?.includes(COPYWRITER_ROLE) ?? false;
  return { isAdmin, isCopywriter, canManageLibrary: isAdmin || isCopywriter };
}
```

Replace the `getAuth` return type + body with:

```ts
export async function getAuth(): Promise<{
  user: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
} & RoleFlags> {
  const auth = await withAuth();
  const user = auth.user
    ? {
        id: auth.user.id,
        email: auth.user.email,
        firstName: auth.user.firstName ?? null,
        lastName: auth.user.lastName ?? null,
      }
    : null;
  return { user, ...deriveRoleFlags(auth.roles) };
}
```

Add `requireLibraryEditor` next to `requireAdmin`:

```ts
/** 403 unless the caller is an admin OR a copywriter. */
export async function requireLibraryEditor(): Promise<NextResponse<{ error: string }> | null> {
  const { canManageLibrary } = await getAuth();
  if (!canManageLibrary) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `bun test tests/unit/auth-roles.test.ts && bun run typecheck`
Expected: test PASS; typecheck PASS (existing `getAuth().isAdmin` consumers still compile — `isAdmin` is still on the return type).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts tests/unit/auth-roles.test.ts
git commit -m "feat(auth): copywriter role flags + requireLibraryEditor"
```

---

### Task 6: Category CRUD API

**Files:**
- Create: `src/app/api/push-library/categories/route.ts` (GET, POST)
- Create: `src/app/api/push-library/categories/[id]/route.ts` (PATCH, DELETE)
- Test: `tests/integration/push-library-categories.test.ts`

**Context:** GET is public (read-only, non-sensitive). POST/PATCH/DELETE use `requireLibraryEditor()`. Slug is auto-derived from label and immutable; PATCH only changes label/sortOrder/isActive. DELETE is blocked (409) when the category still has subcategories (the `onDelete: Restrict` FK throws P2003 → caught explicitly). Every mutation calls `revalidateTag(PUSH_TAXONOMY_TAG)`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-library-categories.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";

mock.module("@/lib/auth", () => ({
  requireLibraryEditor: async () => null,
  requireAdmin: async () => null,
}));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { GET, POST } = await import("@/app/api/push-library/categories/route");
const { PATCH, DELETE } = await import("@/app/api/push-library/categories/[id]/route");

beforeEach(async () => {
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});
afterEach(async () => {
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function req(body: unknown) {
  return new Request("http://t", { method: "POST", body: JSON.stringify(body) });
}

describe("category CRUD", () => {
  it("creates a category with a derived slug", async () => {
    const res = await POST(req({ label: "Holiday Pushes" }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.slug).toBe("holiday-pushes");
    expect(data.label).toBe("Holiday Pushes");
  });

  it("rejects a duplicate slug with 409", async () => {
    await POST(req({ label: "Giving" }));
    const res = await POST(req({ label: "giving" }));
    expect(res.status).toBe(409);
  });

  it("rejects an empty label with 400", async () => {
    const res = await POST(req({ label: "   " }));
    expect(res.status).toBe(400);
  });

  it("GET returns categories ordered by sortOrder", async () => {
    await prisma.pushCategory.create({ data: { slug: "b", label: "B", sortOrder: 1 } });
    await prisma.pushCategory.create({ data: { slug: "a", label: "A", sortOrder: 0 } });
    const res = await GET();
    const { data } = await res.json();
    expect(data.map((c: { slug: string }) => c.slug)).toEqual(["a", "b"]);
  });

  it("PATCH updates label/sortOrder/isActive but not slug", async () => {
    const c = await prisma.pushCategory.create({ data: { slug: "x", label: "X" } });
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify({ label: "X2", slug: "hacked", isActive: false }) }),
      { params: Promise.resolve({ id: c.id }) },
    );
    expect(res.status).toBe(200);
    const fresh = await prisma.pushCategory.findUnique({ where: { id: c.id } });
    expect(fresh?.label).toBe("X2");
    expect(fresh?.slug).toBe("x");
    expect(fresh?.isActive).toBe(false);
  });

  it("DELETE blocks (409) a category that still has subcategories", async () => {
    const c = await prisma.pushCategory.create({ data: { slug: "c", label: "C" } });
    await prisma.pushSubcategory.create({ data: { categoryId: c.id, slug: "s", label: "S" } });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: c.id }) });
    expect(res.status).toBe(409);
  });

  it("DELETE removes an empty category", async () => {
    const c = await prisma.pushCategory.create({ data: { slug: "d", label: "D" } });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: c.id }) });
    expect(res.status).toBe(200);
    expect(await prisma.pushCategory.findUnique({ where: { id: c.id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/push-library-categories.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement `src/app/api/push-library/categories/route.ts`**

```ts
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { slugify } from "@/lib/push-taxonomy";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

export async function GET() {
  try {
    const categories = await prisma.pushCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { subcategories: { orderBy: { sortOrder: "asc" } } },
    });
    return ok(categories);
  } catch (err) {
    return handleRouteError("GET /api/push-library/categories", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return fail("label is required", 400);
  const slug = typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(label);
  if (!slug) return fail("label must contain alphanumeric characters", 400);

  try {
    const max = await prisma.pushCategory.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.pushCategory.create({
      data: { slug, label, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok(created, 201);
  } catch (err) {
    return handleRouteError("POST /api/push-library/categories", err); // P2002 → 409
  }
}
```

- [ ] **Step 4: Implement `src/app/api/push-library/categories/[id]/route.ts`**

```ts
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const data: Prisma.PushCategoryUpdateInput = {};
  if (typeof body.label === "string") {
    if (!body.label.trim()) return fail("label cannot be empty", 400);
    data.label = body.label.trim();
  }
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (Object.keys(data).length === 0) return fail("No valid fields to update", 400);

  try {
    const updated = await prisma.pushCategory.update({ where: { id }, data });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok(updated);
  } catch (err) {
    return handleRouteError(`PATCH /api/push-library/categories/${id}`, err); // P2025 → 404
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  const subCount = await prisma.pushSubcategory.count({ where: { categoryId: id } });
  if (subCount > 0) {
    return fail("Cannot delete a category that still has subcategories — move or delete them first", 409);
  }
  try {
    await prisma.pushCategory.delete({ where: { id } });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok({ id });
  } catch (err) {
    return handleRouteError(`DELETE /api/push-library/categories/${id}`, err); // P2025 → 404
  }
}
```

- [ ] **Step 5: Run the test to confirm pass**

Run: `bun test tests/integration/push-library-categories.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/push-library/categories tests/integration/push-library-categories.test.ts
git commit -m "feat(api): push library category CRUD"
```

---

### Task 7: Subcategory CRUD API

**Files:**
- Create: `src/app/api/push-library/subcategories/route.ts` (POST)
- Create: `src/app/api/push-library/subcategories/[id]/route.ts` (PATCH, DELETE)
- Test: `tests/integration/push-library-subcategories.test.ts`

**Context:** POST requires a valid `categoryId`, derives a globally-unique slug from label. PATCH can change label/sortOrder/isActive/deeplinkBehavior and **move** the subcategory to another category (`categoryId`). DELETE is blocked (409) when any `MessageVariant` still references its slug (force recategorize first). `deeplinkBehavior` accepted values: `"none"` | `"specific-verse"`. All mutations bust `PUSH_TAXONOMY_TAG`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-library-subcategories.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { POST } = await import("@/app/api/push-library/subcategories/route");
const { PATCH, DELETE } = await import("@/app/api/push-library/subcategories/[id]/route");

let catId: string;
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const c = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  catId = c.id;
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

describe("subcategory CRUD", () => {
  it("creates a subcategory under a category with derived slug", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: catId, label: "Year End Appeal" }) }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.slug).toBe("year-end-appeal");
    expect(data.categoryId).toBe(catId);
    expect(data.deeplinkBehavior).toBe("none");
  });

  it("rejects an unknown categoryId with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: "nope", label: "X" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate slug with 409", async () => {
    await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: catId, label: "EOY" }) }));
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: catId, label: "eoy" }) }));
    expect(res.status).toBe(409);
  });

  it("PATCH sets deeplinkBehavior and moves to another category", async () => {
    const other = await prisma.pushCategory.create({ data: { slug: "reader", label: "Reader" } });
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "sv", label: "SV" } });
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify({ deeplinkBehavior: "specific-verse", categoryId: other.id }) }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(200);
    const fresh = await prisma.pushSubcategory.findUnique({ where: { id: s.id } });
    expect(fresh?.deeplinkBehavior).toBe("specific-verse");
    expect(fresh?.categoryId).toBe(other.id);
  });

  it("PATCH rejects an invalid deeplinkBehavior with 400", async () => {
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "z", label: "Z" } });
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify({ deeplinkBehavior: "teleport" }) }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("DELETE blocks (409) when a variant still references the subcategory slug", async () => {
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "inuse", label: "In Use" } });
    const agent = await createAgent({ name: "Push Copy Library" });
    const msg = await createMessage(agent.id, { channel: "push" });
    await createVariant(msg.id, { category: "giving", subcategory: "inuse" });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: s.id }) });
    expect(res.status).toBe(409);
  });

  it("DELETE removes an unused subcategory", async () => {
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "free", label: "Free" } });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: s.id }) });
    expect(res.status).toBe(200);
    expect(await prisma.pushSubcategory.findUnique({ where: { id: s.id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/push-library-subcategories.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement `src/app/api/push-library/subcategories/route.ts`**

```ts
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { slugify } from "@/lib/push-taxonomy";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

const DEEPLINK_BEHAVIORS = new Set(["none", "specific-verse"]);

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!categoryId) return fail("categoryId is required", 400);
  if (!label) return fail("label is required", 400);
  const slug = typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(label);
  if (!slug) return fail("label must contain alphanumeric characters", 400);
  const deeplinkBehavior = typeof body.deeplinkBehavior === "string" ? body.deeplinkBehavior : "none";
  if (!DEEPLINK_BEHAVIORS.has(deeplinkBehavior)) return fail("Invalid deeplinkBehavior", 400);

  const category = await prisma.pushCategory.findUnique({ where: { id: categoryId } });
  if (!category) return fail("categoryId does not exist", 400);

  try {
    const max = await prisma.pushSubcategory.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
    const created = await prisma.pushSubcategory.create({
      data: { categoryId, slug, label, deeplinkBehavior, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok(created, 201);
  } catch (err) {
    return handleRouteError("POST /api/push-library/subcategories", err); // P2002 → 409
  }
}
```

- [ ] **Step 4: Implement `src/app/api/push-library/subcategories/[id]/route.ts`**

```ts
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

const DEEPLINK_BEHAVIORS = new Set(["none", "specific-verse"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const data: Prisma.PushSubcategoryUpdateInput = {};
  if (typeof body.label === "string") {
    if (!body.label.trim()) return fail("label cannot be empty", 400);
    data.label = body.label.trim();
  }
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.deeplinkBehavior === "string") {
    if (!DEEPLINK_BEHAVIORS.has(body.deeplinkBehavior)) return fail("Invalid deeplinkBehavior", 400);
    data.deeplinkBehavior = body.deeplinkBehavior;
  }
  if (typeof body.categoryId === "string") {
    const target = await prisma.pushCategory.findUnique({ where: { id: body.categoryId } });
    if (!target) return fail("categoryId does not exist", 400);
    data.category = { connect: { id: body.categoryId } };
  }
  if (Object.keys(data).length === 0) return fail("No valid fields to update", 400);

  try {
    const updated = await prisma.pushSubcategory.update({ where: { id }, data });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok(updated);
  } catch (err) {
    return handleRouteError(`PATCH /api/push-library/subcategories/${id}`, err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  const sub = await prisma.pushSubcategory.findUnique({ where: { id } });
  if (!sub) return fail("Subcategory not found", 404);

  const inUse = await prisma.messageVariant.count({ where: { subcategory: sub.slug } });
  if (inUse > 0) {
    return fail(`Cannot delete — ${inUse} push(es) still use this subcategory. Recategorize them first`, 409);
  }
  try {
    await prisma.pushSubcategory.delete({ where: { id } });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok({ id });
  } catch (err) {
    return handleRouteError(`DELETE /api/push-library/subcategories/${id}`, err);
  }
}
```

- [ ] **Step 5: Run the test to confirm pass**

Run: `bun test tests/integration/push-library-subcategories.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/push-library/subcategories tests/integration/push-library-subcategories.test.ts
git commit -m "feat(api): push library subcategory CRUD with move + deeplinkBehavior"
```

---

## Phase 3 — Item search/sort/filter, recategorization, reorder, bulk

### Task 8: Server-side search/sort/filter on GET /api/push-library + taxonomy-validated POST

**Files:**
- Modify: `src/app/api/push-library/route.ts`
- Test: `tests/integration/push-library-search.test.ts`

**Context:** GET gains optional query params: `q` (case-insensitive contains over name/title/subject/body/cta), `category`, `subcategory`, `status` (default excludes `archived`), `sort` (`createdAt|name|sortOrder`, default `createdAt`), `dir` (`asc|desc`, default `asc`), `limit` (default 100, max 200), `cursor` (variant id). When NO filter/search params are present, the response keeps today's grouped shape (`{ data: [{category, subcategory, variants}] }`) for backward compatibility with the current UI. When ANY of `q/category/subcategory/sort/dir/limit/cursor` is present, it returns the flat paginated shape `{ data: { items, total, nextCursor } }`. POST swaps `VALID_PUSH_CATEGORIES` for taxonomy validation and `requireAdmin` → `requireLibraryEditor`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-library-search.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { GET, POST } = await import("@/app/api/push-library/route");

async function seedLibrary() {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const cat = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  await prisma.pushSubcategory.create({ data: { categoryId: cat.id, slug: "eoy", label: "EOY" } });
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  await createVariant(msg.id, { name: "Give Now", title: "Donate today", body: "Year end gift", category: "giving", subcategory: "eoy" });
  await createVariant(msg.id, { name: "Read Verse", title: "John 3:16", body: "For God so loved", category: "reader", subcategory: "specific-verse" });
}

beforeEach(seedLibrary);
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function get(qs: string) {
  return GET(new Request(`http://t/api/push-library${qs}`) as never);
}

describe("GET /api/push-library search/filter", () => {
  it("keeps the grouped shape when no params are present", async () => {
    const res = await get("");
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("variants");
  });

  it("returns flat paginated items when q is present", async () => {
    const res = await get("?q=year%20end");
    const { data } = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe("Give Now");
    expect(data.total).toBe(1);
  });

  it("filters by category", async () => {
    const res = await get("?category=reader");
    const { data } = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe("Read Verse");
  });

  it("searches the title field case-insensitively", async () => {
    const res = await get("?q=DONATE");
    const { data } = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe("Give Now");
  });
});

describe("POST /api/push-library taxonomy validation", () => {
  it("rejects a category absent from the taxonomy with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ name: "X", category: "ghost", title: "T", body: "B" }) }) as never);
    expect(res.status).toBe(400);
  });
  it("rejects a subcategory not belonging to the category with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ name: "X", category: "giving", subcategory: "specific-verse", title: "T", body: "B" }) }) as never);
    expect(res.status).toBe(400);
  });
  it("creates a variant for a valid category+subcategory", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ name: "X", category: "giving", subcategory: "eoy", title: "T", body: "B" }) }) as never);
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/push-library-search.test.ts`
Expected: FAIL — new query behavior + taxonomy validation not implemented.

- [ ] **Step 3: Rewrite `src/app/api/push-library/route.ts`**

Replace the whole file with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { getPushTaxonomy } from "@/lib/cache/push-taxonomy";
import { validateVariantTaxonomy } from "@/lib/push-taxonomy";

const FILTER_PARAMS = ["q", "category", "subcategory", "sort", "dir", "limit", "cursor"];
const SORT_FIELDS = new Set(["createdAt", "name", "sortOrder"]);

export async function GET(req: NextRequest) {
  try {
    const agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
    const sp = req.nextUrl.searchParams;
    const hasFilters = FILTER_PARAMS.some((p) => sp.has(p));

    if (!agent) {
      return NextResponse.json({ data: hasFilters ? { items: [], total: 0, nextCursor: null } : [] });
    }

    const status = sp.get("status");
    const where: Prisma.MessageVariantWhereInput = {
      message: { agentId: agent.id },
      status: status ? status : { not: "archived" },
    };
    const category = sp.get("category");
    const subcategory = sp.get("subcategory");
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    const q = sp.get("q")?.trim();
    if (q) {
      where.OR = (["name", "title", "subject", "body", "cta"] as const).map((f) => ({
        [f]: { contains: q, mode: "insensitive" },
      }));
    }

    const select = {
      id: true, name: true, title: true, body: true, subject: true, deeplink: true,
      cta: true, status: true, category: true, subcategory: true, iconImageUrl: true, sortOrder: true,
    };

    if (!hasFilters) {
      const variants = await prisma.messageVariant.findMany({
        where, select,
        orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const grouped = new Map<string, Map<string | null, typeof variants>>();
      for (const v of variants) {
        const cat = v.category ?? "uncategorized";
        if (!grouped.has(cat)) grouped.set(cat, new Map());
        const subMap = grouped.get(cat)!;
        const sub = v.subcategory ?? null;
        if (!subMap.has(sub)) subMap.set(sub, []);
        subMap.get(sub)!.push(v);
      }
      const data = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
        Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
      );
      const res = NextResponse.json({ data });
      res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
      return res;
    }

    const sortField = SORT_FIELDS.has(sp.get("sort") ?? "") ? sp.get("sort")! : "createdAt";
    const dir = sp.get("dir") === "desc" ? "desc" : "asc";
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 200);
    const cursor = sp.get("cursor");

    const [total, items] = await Promise.all([
      prisma.messageVariant.count({ where }),
      prisma.messageVariant.findMany({
        where, select,
        orderBy: [{ [sortField]: dir }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ]);
    const nextCursor = items.length > limit ? items[limit - 1].id : null;
    return ok({ items: items.slice(0, limit), total, nextCursor });
  } catch (err) {
    return handleRouteError("GET /api/push-library", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { name, category, subcategory, title, body: msgBody, deeplink, cta, iconImageUrl } = body as {
    name?: unknown; category?: unknown; subcategory?: unknown; title?: unknown;
    body?: unknown; deeplink?: unknown; cta?: unknown; iconImageUrl?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") return fail("name is required", 400);
  if (typeof category !== "string") return fail("category is required", 400);
  if (typeof msgBody !== "string" || msgBody.trim() === "") return fail("body is required", 400);
  if (typeof title !== "string" || title.trim() === "") return fail("title is required for push", 400);

  const subSlug = typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null;
  const taxonomy = await getPushTaxonomy();
  const valid = validateVariantTaxonomy(taxonomy, category, subSlug);
  if (!valid.ok) return fail(valid.error, 400);

  try {
    let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
    if (!agent) {
      agent = await prisma.agent.create({
        data: {
          name: LIBRARY_AGENT_NAME,
          description: "Canonical push copy templates. Never used for decisions — status stays draft.",
          algorithm: "thompson", epsilon: 0.1, status: "draft", funnelStage: "connected",
        },
      });
    }
    let message = await prisma.message.findFirst({ where: { agentId: agent.id, variants: { some: { category } } } });
    if (!message) {
      message = await prisma.message.create({ data: { agentId: agent.id, name: `${category} Templates`, channel: "push" } });
    }
    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id, name: name.trim(), title: title.trim(), body: msgBody.trim(),
        deeplink: typeof deeplink === "string" ? deeplink.trim() || null : null,
        cta: typeof cta === "string" ? cta.trim() || null : null,
        category, subcategory: subSlug,
        iconImageUrl: typeof iconImageUrl === "string" ? iconImageUrl.trim() || null : null,
        status: "active",
      },
    });
    revalidateTag("agents", "max");
    return ok(variant, 201);
  } catch (err) {
    return handleRouteError("POST /api/push-library", err);
  }
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `bun test tests/integration/push-library-search.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push-library/route.ts tests/integration/push-library-search.test.ts
git commit -m "feat(api): server-side push library search/sort/filter + taxonomy-validated POST"
```

---

### Task 9: Variant PATCH recategorization (both levels) + reorder field + role gate

**Files:**
- Modify: `src/app/api/variants/[id]/route.ts`
- Modify: `src/app/api/push-library/[id]/route.ts` (swap `requireAdmin` → `requireLibraryEditor`)
- Test: `tests/integration/variant-recategorize.test.ts`

**Context:** Add `subcategory` and `sortOrder` to `UPDATABLE_FIELDS`. When `category` or `subcategory` is being changed, validate the *resulting* pair against the taxonomy before the DB write. Swap `requireAdmin` → `requireLibraryEditor` on both PATCH and DELETE here and on the push-library `[id]` DELETE. Keep the existing push-completeness check and clone-sync behavior untouched.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/variant-recategorize.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { PATCH } = await import("@/app/api/variants/[id]/route");

let variantId: string;
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const reader = await prisma.pushCategory.create({ data: { slug: "reader", label: "Reader" } });
  await prisma.pushSubcategory.create({ data: { categoryId: reader.id, slug: "open-bible", label: "Open Bible" } });
  const giving = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  await prisma.pushSubcategory.create({ data: { categoryId: giving.id, slug: "eoy", label: "EOY" } });
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const v = await createVariant(msg.id, { title: "T", body: "B", category: "reader", subcategory: "open-bible" });
  variantId = v.id;
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function patch(id: string, body: unknown) {
  return PATCH(new Request("http://t", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

describe("variant recategorization", () => {
  it("recategorizes to a new category + subcategory", async () => {
    const res = await patch(variantId, { category: "giving", subcategory: "eoy" });
    expect(res.status).toBe(200);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: variantId } });
    expect(fresh?.category).toBe("giving");
    expect(fresh?.subcategory).toBe("eoy");
  });

  it("rejects a subcategory that does not belong to the resulting category (400)", async () => {
    const res = await patch(variantId, { category: "giving", subcategory: "open-bible" });
    expect(res.status).toBe(400);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: variantId } });
    expect(fresh?.category).toBe("reader");
  });

  it("updates sortOrder", async () => {
    const res = await patch(variantId, { sortOrder: 5 });
    expect(res.status).toBe(200);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: variantId } });
    expect(fresh?.sortOrder).toBe(5);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/variant-recategorize.test.ts`
Expected: FAIL — `subcategory`/`sortOrder` not whitelisted; no taxonomy validation.

- [ ] **Step 3: Edit `src/app/api/variants/[id]/route.ts`**

Change the import line `import { requireAdmin } from "@/lib/auth";` to:

```ts
import { requireLibraryEditor } from "@/lib/auth";
import { getPushTaxonomy } from "@/lib/cache/push-taxonomy";
import { validateVariantTaxonomy } from "@/lib/push-taxonomy";
```

Add `subcategory` and `sortOrder` to `UPDATABLE_FIELDS`:

```ts
const UPDATABLE_FIELDS = new Set([
  "name", "subject", "body", "cta", "status", "brazeVariantId", "title",
  "iconImageUrl", "deeplink", "preferredHour", "preferredDayOfWeek",
  "frequencyCapOverride", "warmupUntil", "actionFeatures", "category",
  "subcategory", "sortOrder",
]);
```

In `PATCH`, replace `const forbidden = await requireAdmin();` with `const forbidden = await requireLibraryEditor();`. In `DELETE`, do the same.

After the `updateData` whitelist loop and the empty-check, before the push-completeness block, add taxonomy validation for category/subcategory changes:

```ts
  if ("category" in updateData || "subcategory" in updateData) {
    const resultingCategory = "category" in updateData ? updateData.category : variant.category;
    const resultingSub = "subcategory" in updateData ? updateData.subcategory : variant.subcategory;
    if (typeof resultingCategory !== "string") {
      return NextResponse.json({ error: "category is required" }, { status: 400 });
    }
    const taxonomy = await getPushTaxonomy();
    const subSlug = typeof resultingSub === "string" && resultingSub.trim() ? resultingSub.trim() : null;
    const valid = validateVariantTaxonomy(taxonomy, resultingCategory, subSlug);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  }
```

- [ ] **Step 4: Edit `src/app/api/push-library/[id]/route.ts`**

Change `import { requireAdmin } from "@/lib/auth";` → `import { requireLibraryEditor } from "@/lib/auth";` and replace the `const forbidden = await requireAdmin();` line in `DELETE` with `const forbidden = await requireLibraryEditor();`.

- [ ] **Step 5: Run the test + typecheck**

Run: `bun test tests/integration/variant-recategorize.test.ts && bun run typecheck`
Expected: PASS (3 cases); typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/variants/\[id\]/route.ts src/app/api/push-library/\[id\]/route.ts tests/integration/variant-recategorize.test.ts
git commit -m "feat(api): variant recategorization + sortOrder + library-editor gate"
```

---

### Task 10: Reorder endpoint (persist drag order)

**Files:**
- Create: `src/app/api/push-library/reorder/route.ts` (POST)
- Test: `tests/integration/push-library-reorder.test.ts`

**Context:** Accepts `{ ids: string[] }` — the new top-to-bottom order of variants within a single subcategory. Writes contiguous `sortOrder` (0..n-1) in one transaction. Gated by `requireLibraryEditor`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-library-reorder.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { POST } = await import("@/app/api/push-library/reorder/route");

let ids: string[];
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const a = await createVariant(msg.id, { name: "A", title: "A", body: "a", category: "giving", subcategory: "eoy" });
  const b = await createVariant(msg.id, { name: "B", title: "B", body: "b", category: "giving", subcategory: "eoy" });
  const c = await createVariant(msg.id, { name: "C", title: "C", body: "c", category: "giving", subcategory: "eoy" });
  ids = [a.id, b.id, c.id];
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
});

describe("POST /api/push-library/reorder", () => {
  it("writes contiguous sortOrder in the given order", async () => {
    const reordered = [ids[2], ids[0], ids[1]];
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ ids: reordered }) }));
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { id: true, sortOrder: true } });
    const order = new Map(rows.map((r) => [r.id, r.sortOrder]));
    expect(order.get(ids[2])).toBe(0);
    expect(order.get(ids[0])).toBe(1);
    expect(order.get(ids[1])).toBe(2);
  });

  it("rejects a non-array body with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ ids: "nope" }) }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/push-library-reorder.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `src/app/api/push-library/reorder/route.ts`**

```ts
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const ids = body.ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    return fail("ids must be an array of variant ids", 400);
  }
  if (ids.length === 0) return ok({ updated: 0 });

  try {
    await prisma.$transaction(
      (ids as string[]).map((id, i) =>
        prisma.messageVariant.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    revalidateTag("agents", "max");
    return ok({ updated: ids.length });
  } catch (err) {
    return handleRouteError("POST /api/push-library/reorder", err);
  }
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `bun test tests/integration/push-library-reorder.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push-library/reorder tests/integration/push-library-reorder.test.ts
git commit -m "feat(api): push library reorder endpoint"
```

---

### Task 11: Bulk operations endpoint

**Files:**
- Create: `src/app/api/push-library/bulk/route.ts` (POST)
- Test: `tests/integration/push-library-bulk.test.ts`

**Context:** Accepts `{ ids: string[], op: "recategorize" | "setStatus" | "delete", category?, subcategory?, status? }`. `recategorize` validates the target category/subcategory pair against the taxonomy once, then applies to all ids. `setStatus` sets `status` on all. `delete` soft-deletes (status `archived`). Gated by `requireLibraryEditor`. All variant write paths bust the `agents` tag.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-library-bulk.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { POST } = await import("@/app/api/push-library/bulk/route");

let ids: string[];
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const giving = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  await prisma.pushSubcategory.create({ data: { categoryId: giving.id, slug: "eoy", label: "EOY" } });
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const a = await createVariant(msg.id, { name: "A", title: "A", body: "a", category: "reader", subcategory: "open-bible" });
  const b = await createVariant(msg.id, { name: "B", title: "B", body: "b", category: "reader", subcategory: "open-bible" });
  ids = [a.id, b.id];
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function post(body: unknown) {
  return POST(new Request("http://t", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/push-library/bulk", () => {
  it("bulk recategorizes after validating the target pair", async () => {
    const res = await post({ ids, op: "recategorize", category: "giving", subcategory: "eoy" });
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { category: true, subcategory: true } });
    expect(rows.every((r) => r.category === "giving" && r.subcategory === "eoy")).toBe(true);
  });

  it("rejects bulk recategorize to an invalid pair with 400", async () => {
    const res = await post({ ids, op: "recategorize", category: "giving", subcategory: "open-bible" });
    expect(res.status).toBe(400);
  });

  it("bulk sets status", async () => {
    const res = await post({ ids, op: "setStatus", status: "paused" });
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { status: true } });
    expect(rows.every((r) => r.status === "paused")).toBe(true);
  });

  it("bulk delete soft-archives", async () => {
    const res = await post({ ids, op: "delete" });
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { status: true } });
    expect(rows.every((r) => r.status === "archived")).toBe(true);
  });

  it("rejects an unknown op with 400", async () => {
    const res = await post({ ids, op: "frobnicate" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `bun test tests/integration/push-library-bulk.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement `src/app/api/push-library/bulk/route.ts`**

```ts
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { getPushTaxonomy } from "@/lib/cache/push-taxonomy";
import { validateVariantTaxonomy } from "@/lib/push-taxonomy";

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const ids = body.ids;
  const op = body.op;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== "string")) {
    return fail("ids must be a non-empty array of variant ids", 400);
  }
  const where = { id: { in: ids as string[] } };

  try {
    if (op === "recategorize") {
      const category = body.category;
      if (typeof category !== "string") return fail("category is required", 400);
      const subSlug = typeof body.subcategory === "string" && body.subcategory.trim() ? body.subcategory.trim() : null;
      const taxonomy = await getPushTaxonomy();
      const valid = validateVariantTaxonomy(taxonomy, category, subSlug);
      if (!valid.ok) return fail(valid.error, 400);
      const r = await prisma.messageVariant.updateMany({ where, data: { category, subcategory: subSlug } });
      revalidateTag("agents", "max");
      return ok({ updated: r.count });
    }
    if (op === "setStatus") {
      const status = body.status;
      if (typeof status !== "string" || !status.trim()) return fail("status is required", 400);
      const r = await prisma.messageVariant.updateMany({ where, data: { status } });
      revalidateTag("agents", "max");
      return ok({ updated: r.count });
    }
    if (op === "delete") {
      const r = await prisma.messageVariant.updateMany({ where, data: { status: "archived" } });
      revalidateTag("agents", "max");
      return ok({ updated: r.count });
    }
    return fail("Unknown op", 400);
  } catch (err) {
    return handleRouteError("POST /api/push-library/bulk", err);
  }
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `bun test tests/integration/push-library-bulk.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push-library/bulk tests/integration/push-library-bulk.test.ts
git commit -m "feat(api): push library bulk recategorize/status/delete"
```

---

## Phase 4 — UI rewiring

> UI tasks are verified manually on the dev server (`bun run dev`, http://localhost:3000/messages) plus a typecheck — this repo's automated tests cover libs and API routes, not rendered components. The API integration tests from Phase 2–3 already protect the behavior these components call.

### Task 12: Client taxonomy hook + page wiring (canManageLibrary)

**Files:**
- Create: `src/components/push-library/use-taxonomy.ts`
- Modify: `src/app/messages/page.tsx`

**Context:** A small client hook fetches `GET /api/push-library/categories` once and exposes the taxonomy + active-only helpers to the form and management UI. The page swaps `isAdmin = !!user` for the real `canManageLibrary` flag and passes it through.

- [ ] **Step 1: Create `src/components/push-library/use-taxonomy.ts`**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

export type UISubcategory = { id: string; slug: string; label: string; sortOrder: number; deeplinkBehavior: string; isActive: boolean };
export type UICategory = { id: string; slug: string; label: string; sortOrder: number; isActive: boolean; subcategories: UISubcategory[] };

export function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<UICategory[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/push-library/categories");
      const json = await res.json();
      setTaxonomy(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { taxonomy, loading, refresh };
}

/** Active categories only, with active subcategories — for pickers. */
export function activeTaxonomy(taxonomy: UICategory[]): UICategory[] {
  return taxonomy
    .filter((c) => c.isActive)
    .map((c) => ({ ...c, subcategories: c.subcategories.filter((s) => s.isActive) }));
}
```

- [ ] **Step 2: Edit `src/app/messages/page.tsx` — use the real role flag**

Replace lines 62-64 (the `MessagesPage` signature through the `isAdmin` const):

```tsx
export default async function MessagesPage() {
  const [{ canManageLibrary }, groups] = await Promise.all([getAuth(), getGroups()]);
```

Then replace every remaining `isAdmin` in this file with `canManageLibrary` (the `<Header>` button gate on line 72, the `PushTranslationUpload` gate on line 79, and the `<PushLibraryClient ... isAdmin={isAdmin} />` prop on line 91 → `canManageLibrary={canManageLibrary}`).

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (note: `PushLibraryClient` prop is renamed in Task 14; if running this task standalone, the prop change there must land together — execute Tasks 12 and 14 before typechecking the page, or temporarily keep the `isAdmin` prop name until Task 14). Recommended: run typecheck after Task 14.

- [ ] **Step 4: Commit**

```bash
git add src/components/push-library/use-taxonomy.ts src/app/messages/page.tsx
git commit -m "feat(ui): taxonomy hook + canManageLibrary on push library page"
```

---

### Task 13: Form sheet — taxonomy-driven category/subcategory + deeplinkBehavior

**Files:**
- Modify: `src/components/push-library/template-form-sheet.tsx`

**Context:** Today the form imports `PUSH_CATEGORIES`/`SUBCATEGORIES` from `push-categories.ts` and special-cases `subcategory === "specific-verse"` to drive the verse-deeplink UI. Rewire it to use `useTaxonomy()` for the category/subcategory selects and to drive the verse-deeplink UI from the selected subcategory's `deeplinkBehavior === "specific-verse"`. **Read the current file first** — preserve all existing form fields, the create (POST `/api/push-library`) vs edit (PATCH `/api/variants/[id]`) submit logic, and the personalization preview.

- [ ] **Step 1: Replace the taxonomy imports/derivations**

Remove the import of category constants from `@/lib/push-categories` and add:

```tsx
import { useTaxonomy, activeTaxonomy } from "./use-taxonomy";
```

Inside the component, derive options from the hook:

```tsx
  const { taxonomy } = useTaxonomy();
  const active = activeTaxonomy(taxonomy);
  const categoryOptions = active.map((c) => ({ value: c.slug, label: c.label }));
  const selectedCategory = active.find((c) => c.slug === category);
  const subcategoryOptions = selectedCategory
    ? selectedCategory.subcategories.map((s) => ({ value: s.slug, label: s.label }))
    : [];
  const selectedSub = selectedCategory?.subcategories.find((s) => s.slug === subcategory);
  const isVerseDeeplink = selectedSub?.deeplinkBehavior === "specific-verse";
```

- [ ] **Step 2: Drive the verse-deeplink UI off `isVerseDeeplink`**

Replace every `subcategory === "specific-verse"` comparison in this file (the deeplink mode state initializer, the `effectiveDeeplink` computation, the conditional deeplink input render, and the preview `deeplink` prop) with the `isVerseDeeplink` boolean. The initializer that reads `variant?.subcategory === "specific-verse"` becomes a check against the loaded taxonomy:

```tsx
  // verse-deeplink mode is meaningful only when the selected subcategory's behavior is specific-verse
  const [verseMode, setVerseMode] = useState<SpecificVerseDeeplinkMode>(
    isSpecificVerseDeeplink(variant?.deeplink) ? "specific" : "generic",
  );
```

(Keep using `isSpecificVerseDeeplink`/`parseUsfmFromDeeplink`/`buildSpecificVerseDeeplink` from `@/lib/push-deeplinks` for parsing the deeplink string itself — only the *gate* changes from a hardcoded slug to `isVerseDeeplink`.)

- [ ] **Step 3: Render the category select from `categoryOptions`**

Replace the hardcoded category `<SelectItem>` list with a map over `categoryOptions` (value=`c.value`, label=`c.label`), and the subcategory list with a map over `subcategoryOptions`. Render the subcategory select only when `subcategoryOptions.length > 0`.

- [ ] **Step 4: Manual verification**

Run: `bun run dev`
- Open http://localhost:3000/messages, click **+ New Push**.
- Confirm the Category select lists the seeded categories from the DB (not a stale hardcoded list).
- Select **Reader → Specific Verse**: the verse-reference deeplink UI appears.
- Select **Giving → End of Year**: the plain deeplink input appears.
- Create a push; confirm it appears in the library.

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/components/push-library/template-form-sheet.tsx
git commit -m "feat(ui): form sheet reads taxonomy from API + deeplinkBehavior gate"
```

---

### Task 14: Library client — server-driven search/sort/filter, bulk toolbar, drag-reorder

**Files:**
- Modify: `src/components/push-library/push-library-client.tsx`

**Context:** **Read the current file first.** Today search/filter run client-side over the `groups` prop and the prop is `isAdmin`. Change: (1) rename prop `isAdmin` → `canManageLibrary`; (2) drive category/subcategory filter pills from `useTaxonomy()` instead of `PUSH_CATEGORY_VALUES`; (3) add a debounced server query to `GET /api/push-library?q=&category=&subcategory=&sort=&dir=` that replaces the in-memory filter when any filter is active, falling back to the grouped `groups` prop when no filter is set; (4) add a sort dropdown (Newest/Name); (5) add a multi-select bulk toolbar (recategorize/set-status/delete) calling `/api/push-library/bulk`, gated by `canManageLibrary`; (6) add drag-to-reorder within a subcategory group persisting via `POST /api/push-library/reorder`, gated by `canManageLibrary`.

- [ ] **Step 1: Rename the prop + update the type**

In the `Props` type change `isAdmin: boolean;` → `canManageLibrary: boolean;`, update the function signature destructure, and replace all `isAdmin` references in the component body and JSX with `canManageLibrary`. Remove `import { PUSH_CATEGORY_VALUES } from "@/lib/push-categories";` and the `const CATEGORY_ORDER = PUSH_CATEGORY_VALUES;` line.

- [ ] **Step 2: Source filter pills + category order from the taxonomy hook**

Add at the top of the component:

```tsx
  const { taxonomy } = useTaxonomy();
  const categoryOrder = taxonomy.map((c) => c.slug);
```

Replace uses of `CATEGORY_ORDER` with `categoryOrder`, and build the category/subcategory filter pills from `taxonomy` (label via `taxonomy.find(c => c.slug === cat)?.label ?? formatLabel(cat)`), keeping the existing `formatLabel` only as a fallback. Add the import:

```tsx
import { useTaxonomy } from "./use-taxonomy";
```

- [ ] **Step 3: Add the debounced server query**

Add state + effect that fetches when a filter/search/sort is active, and use its result instead of the client-filtered list:

```tsx
  const [sort, setSort] = useState<"createdAt" | "name">("createdAt");
  const [serverItems, setServerItems] = useState<TemplateVariant[] | null>(null);

  useEffect(() => {
    const active = search.trim() || categoryFilter || subcategoryFilter || sort !== "createdAt";
    if (!active) { setServerItems(null); return; }
    const t = setTimeout(async () => {
      const p = new URLSearchParams();
      if (search.trim()) p.set("q", search.trim());
      if (categoryFilter) p.set("category", categoryFilter);
      if (subcategoryFilter) p.set("subcategory", subcategoryFilter);
      p.set("sort", sort);
      const res = await fetch(`/api/push-library?${p.toString()}`);
      const json = await res.json();
      setServerItems(json.data?.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, categoryFilter, subcategoryFilter, sort]);
```

When `serverItems` is non-null, render a flat list of those items (reuse `TemplateCard`/the table row markup); when null, render the existing grouped view from `groups`. Add a sort `<select>` (Newest=`createdAt`, Name=`name`) near the search input. Import `useEffect` from React.

- [ ] **Step 4: Add the bulk-select toolbar (gated by canManageLibrary)**

Add `const [selected, setSelected] = useState<Set<string>>(new Set());` and, when `canManageLibrary && selected.size > 0`, render a toolbar with: a category/subcategory picker (from `taxonomy`) + **Recategorize** button → `POST /api/push-library/bulk { ids:[...selected], op:"recategorize", category, subcategory }`; a **Set status** control (active/paused) → `op:"setStatus"`; a **Delete** button → `op:"delete"`. After a successful call, clear `selected` and `location.reload()` (simplest correct refresh; matches the existing delete flow). Add a checkbox to each card/row that toggles membership in `selected`.

- [ ] **Step 5: Add drag-to-reorder within a subcategory group (gated by canManageLibrary)**

For each grouped subcategory section, when `canManageLibrary` and no server filter is active, make rows draggable (HTML5 `draggable`, `onDragStart`/`onDragOver`/`onDrop` reordering a local copy of that group's `variants`). On drop, `POST /api/push-library/reorder { ids: orderedIds }` then update local state. Disable reorder while a server filter is active (ordering is meaningful only in the grouped view).

- [ ] **Step 6: Manual verification**

Run: `bun run dev` → http://localhost:3000/messages
- Type in search: results narrow via the server (network tab shows `/api/push-library?q=`).
- Click a category pill, then a subcategory pill: list filters server-side.
- Switch sort to **Name**: order changes.
- As an admin/copywriter: select 2 pushes, **Recategorize** to a new subcategory, confirm they move; **Set status → paused**; **Delete** archives them.
- Drag a row within a group to a new position, reload: order persists.

- [ ] **Step 7: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/components/push-library/push-library-client.tsx
git commit -m "feat(ui): server-driven search/sort/filter + bulk + reorder in push library"
```

---

### Task 15: Manage Categories sheet (taxonomy CRUD UI)

**Files:**
- Create: `src/components/push-library/manage-categories-sheet.tsx`
- Modify: `src/app/messages/page.tsx` (render the trigger when `canManageLibrary`)

**Context:** A sheet/dialog for CRUD on categories and subcategories, gated by `canManageLibrary`. Uses `useTaxonomy()` for data + `refresh()` after each mutation. Each category row: editable label (PATCH), active toggle (PATCH `isActive`), delete (DELETE — surfaces the 409 message when it still has subcategories). Each subcategory row: editable label, `deeplinkBehavior` select (none/specific-verse), move-to-category select (PATCH `categoryId`), active toggle, delete (surfaces the 409 in-use message). "Add category" and "Add subcategory" inputs (POST).

- [ ] **Step 1: Create `src/components/push-library/manage-categories-sheet.tsx`**

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTaxonomy } from "./use-taxonomy";

export function ManageCategoriesSheet({ children }: { children: ReactNode }) {
  const { taxonomy, refresh } = useTaxonomy();
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");

  async function call(input: RequestInfo, init: RequestInit) {
    setError(null);
    const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Request failed");
      return false;
    }
    await refresh();
    return true;
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    if (await call("/api/push-library/categories", { method: "POST", body: JSON.stringify({ label: newCategory.trim() }) })) {
      setNewCategory("");
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Manage Categories</SheetTitle>
        </SheetHeader>
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}

        <div className="flex gap-2 my-4">
          <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category label" />
          <Button onClick={addCategory}>Add</Button>
        </div>

        <div className="space-y-6">
          {taxonomy.map((cat) => (
            <CategoryBlock key={cat.id} cat={cat} categories={taxonomy} onChange={refresh} onError={setError} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CategoryBlock({
  cat, categories, onChange, onError,
}: {
  cat: { id: string; slug: string; label: string; isActive: boolean; subcategories: { id: string; slug: string; label: string; deeplinkBehavior: string; isActive: boolean }[] };
  categories: { id: string; label: string }[];
  onChange: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [label, setLabel] = useState(cat.label);
  const [newSub, setNewSub] = useState("");

  async function call(input: RequestInfo, init: RequestInit) {
    onError(null);
    const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) { const j = await res.json().catch(() => ({})); onError(j.error ?? "Request failed"); return false; }
    await onChange();
    return true;
  }

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="font-medium" />
        <Button size="sm" variant="outline" onClick={() => call(`/api/push-library/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ label }) })}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => call(`/api/push-library/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !cat.isActive }) })}>{cat.isActive ? "Disable" : "Enable"}</Button>
        <Button size="sm" variant="destructive" onClick={() => call(`/api/push-library/categories/${cat.id}`, { method: "DELETE" })}>Delete</Button>
      </div>

      <div className="mt-3 ml-4 space-y-2">
        {cat.subcategories.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{s.label}{!s.isActive && " (disabled)"}</span>
            <select defaultValue={s.deeplinkBehavior} onChange={(e) => call(`/api/push-library/subcategories/${s.id}`, { method: "PATCH", body: JSON.stringify({ deeplinkBehavior: e.target.value }) })} className="border rounded px-1 py-0.5">
              <option value="none">none</option>
              <option value="specific-verse">specific-verse</option>
            </select>
            <select defaultValue={cat.id} onChange={(e) => call(`/api/push-library/subcategories/${s.id}`, { method: "PATCH", body: JSON.stringify({ categoryId: e.target.value }) })} className="border rounded px-1 py-0.5">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={() => call(`/api/push-library/subcategories/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !s.isActive }) })}>{s.isActive ? "Disable" : "Enable"}</Button>
            <Button size="sm" variant="destructive" onClick={() => call(`/api/push-library/subcategories/${s.id}`, { method: "DELETE" })}>Delete</Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="New subcategory label" className="h-8" />
          <Button size="sm" onClick={async () => { if (newSub.trim() && await call("/api/push-library/subcategories", { method: "POST", body: JSON.stringify({ categoryId: cat.id, label: newSub.trim() }) })) setNewSub(""); }}>Add</Button>
        </div>
      </div>
    </div>
  );
}
```

(If `@/components/ui/sheet` is missing, add it with `npx shadcn add sheet`.)

- [ ] **Step 2: Add the trigger to `src/app/messages/page.tsx`**

Import the sheet and render its trigger in the `<Header>` next to **+ New Push**, gated by `canManageLibrary`:

```tsx
import { ManageCategoriesSheet } from "@/components/push-library/manage-categories-sheet";
```

```tsx
        {canManageLibrary ? (
          <div className="flex gap-2">
            <ManageCategoriesSheet>
              <Button size="sm" variant="outline">Manage Categories</Button>
            </ManageCategoriesSheet>
            <TemplateFormSheet mode="create">
              <Button size="sm">+ New Push</Button>
            </TemplateFormSheet>
          </div>
        ) : null}
```

- [ ] **Step 3: Manual verification**

Run: `bun run dev` → http://localhost:3000/messages
- Click **Manage Categories**. Add a category; it appears. Rename it; Save persists.
- Add a subcategory under it; set its deeplinkBehavior; move it to another category.
- Try to delete a category that has subcategories → see the 409 message.
- Delete an unused subcategory → it disappears. Try to delete one that's in use → see the in-use 409 message.

- [ ] **Step 4: Typecheck + commit**

Run: `bun run typecheck`
```bash
git add src/components/push-library/manage-categories-sheet.tsx src/app/messages/page.tsx
git commit -m "feat(ui): manage categories sheet (taxonomy CRUD)"
```

---

### Task 16: Pin the copywriter role slug + authorization regression + retire hardcoded list

**Files:**
- Create: `tests/regression/copywriter-library-authorization.test.ts`
- Modify: `src/lib/auth.ts` (only if Task 13 verification shows the slug differs from `"copywriter"`)
- Modify: `src/lib/push-categories.ts` (mark as seed-only; remove `VALID_PUSH_CATEGORIES` export if no runtime consumers remain)

**Context:** Confirm the real WorkOS role slug, lock the copywriter authorization boundary with a regression test, and retire the now-unused hardcoded validation export.

- [ ] **Step 1: Verify the WorkOS role slug**

Run the dev server, sign in as a user who has the **Copywriter** role, and add a temporary log in `getAuth` (`console.log("roles", auth.roles)`) — or check the WorkOS dashboard → Roles → the role's **slug** field. Confirm the slug equals `"copywriter"`. If it differs (e.g. `"copy-writer"`), update `COPYWRITER_ROLE` in `src/lib/auth.ts` to the exact slug. Remove the temporary log.

- [ ] **Step 2: Write the authorization regression test**

Create `tests/regression/copywriter-library-authorization.test.ts`:

```ts
// Regression: the copywriter role has full push-library parity but NO access
// outside it. Guards the requireLibraryEditor vs requireAdmin split so a future
// refactor can't silently grant copywriters agent/persona/settings access or
// lock them out of the library.
import { describe, expect, it } from "bun:test";
import { deriveRoleFlags } from "@/lib/auth";

describe("regression: copywriter authorization boundary", () => {
  it("copywriter can manage the library", () => {
    expect(deriveRoleFlags(["copywriter"]).canManageLibrary).toBe(true);
  });
  it("copywriter is NOT an admin (no access to admin-only surfaces)", () => {
    expect(deriveRoleFlags(["copywriter"]).isAdmin).toBe(false);
  });
  it("admin can manage the library too", () => {
    expect(deriveRoleFlags(["admin"]).canManageLibrary).toBe(true);
  });
  it("a user with neither role manages nothing", () => {
    const f = deriveRoleFlags(["viewer"]);
    expect(f.canManageLibrary).toBe(false);
    expect(f.isAdmin).toBe(false);
  });
});
```

Run: `bun test tests/regression/copywriter-library-authorization.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 3: Retire the hardcoded validation list**

Confirm no runtime code still imports `VALID_PUSH_CATEGORIES`:

Run: `grep -rn "VALID_PUSH_CATEGORIES" src/`
Expected: no matches outside `push-categories.ts` (POST validation now uses the taxonomy). If clean, delete the `VALID_PUSH_CATEGORIES` export from `src/lib/push-categories.ts` and update the file's top comment to note it is now **seed-only data** (consumed solely by the migration's seed and superseded at runtime by `getPushTaxonomy()`). Leave `PUSH_CATEGORIES` in place if `template-picker.tsx`/`variant-picker.tsx` still import it; otherwise migrate those to `useTaxonomy()` in a follow-up (out of scope — note it in the commit body).

Run: `grep -rln "push-categories" src/` and confirm any remaining importers compile.

- [ ] **Step 4: Full check**

Run: `bun run check`
Expected: typecheck + lint + full unit/integration/regression suites PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/regression/copywriter-library-authorization.test.ts src/lib/auth.ts src/lib/push-categories.ts
git commit -m "test(auth): copywriter library authorization boundary + retire hardcoded category list"
```

---

## Self-Review

**Spec coverage** (each spec requirement → task):
- Server-side search → Task 8. Sort/filter → Task 8 + 14. Pagination → Task 8.
- Manual edit/recategorize each push (both levels) → Task 9 (+ Task 14 UI).
- Reorder → Task 10 (+ Task 14 drag UI). Bulk CRUD → Task 11 (+ Task 14 toolbar).
- User-managed categories CRUD → Task 6 (+ Task 15 UI). Subcategories CRUD → Task 7 (+ Task 15 UI).
- Two editable levels → Tasks 1/6/7. deeplinkBehavior replaces specific-verse coupling → Tasks 1/3/4/13.
- Taxonomy migration + seed → Task 2. Cached accessor → Task 4.
- Copywriter role (WorkOS) + full parity, 403 elsewhere → Task 5 (gate), Tasks 6–11 (apply gate), Task 16 (verify slug + regression).
- In-use delete blocked (409) → Task 6 (category) + Task 7 (subcategory).
- Tests for every change → each task includes unit/integration/regression.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `PushTaxonomy`/`TaxonomyCategory`/`TaxonomySubcategory` (Task 3) reused by Task 4's accessor and Task 8/9/11 validation. `deriveRoleFlags`/`RoleFlags`/`requireLibraryEditor` (Task 5) reused by Tasks 6–11 + 16. `PUSH_TAXONOMY_TAG` (Task 4) reused by all taxonomy mutations. `getPushTaxonomy` (Task 4) reused by Tasks 8/9/11. `useTaxonomy`/`activeTaxonomy` (Task 12) reused by Tasks 13/14/15.

**Known cross-task ordering note:** the `MessagesPage` prop rename (Task 12) and the `PushLibraryClient` prop rename (Task 14) must land together for a clean typecheck — flagged in Task 12 Step 3.

**Seed count clarification:** the spec said "21 subcategories"; the canonical de-duplicated seed is **20 distinct subcategory rows** (the form list double-counts the `guided-prayer` value). Encoded in Task 2 Step 3's expected check.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-push-library-overhaul.md`.
