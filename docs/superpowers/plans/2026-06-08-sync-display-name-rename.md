# Sync Display-Name Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `sync-name-overrides.json` with a DB-backed, admin-editable display name per Hightouch sync (keyed by sync id), editable inline in the syncs table, that never affects sync triggering.

**Architecture:** A `SyncNameOverride` Prisma model (`syncId` PK → `displayName`) is read server-side on the `force-dynamic` Data Ingest page and passed to the client `SyncsTable` as an `overrides` map. Name resolution moves to a pure, unit-tested lib helper. Writes go through an admin-gated `PUT`/`DELETE` REST endpoint using the repo's `ok`/`fail` envelope. Inline edit mutates via that endpoint, then optimistically updates and calls `router.refresh()`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL, bun:test, shadcn/ui, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-08-sync-display-name-rename-design.md`

---

## Critical project rules (read before starting)

- **NEVER** run `prisma migrate dev` or `prisma db push` — `prisma.config.ts` loads `.env.local` (PRODUCTION DB). Use idempotent DDL + a manual migration folder + `prisma migrate resolve --applied`.
- **Local test DB** commands MUST be prefixed with:
  ```
  env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test"
  ```
- **NEVER** run tests in the background. Use `bun run test:quick` while iterating; `bun run check` before the MR.
- After `npx prisma generate`, revert any `apps/api/src/generated/prisma/` churn with `git checkout -- apps/api/src/generated/prisma/`.
- No `any`. Routes return `{ data: T }` / `{ error: string }` with correct status. Validate input before DB access.

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` (modify) | Add `SyncNameOverride` model |
| `prisma/migrations/<ts>_add_sync_name_override/migration.sql` (create) | Idempotent DDL + seed |
| `src/lib/hightouch/sync-display-name.ts` (create) | Pure resolver `syncDisplayName` + `humanizeSlug` + `ABBREVS` |
| `src/app/api/hightouch/syncs/[id]/name/route.ts` (create) | Admin `PUT` (upsert) + `DELETE` (clear) |
| `src/app/data-ingest/page.tsx` (modify) | `getCachedOverrides()`, thread `overrides` into `SyncsTable` |
| `src/components/data-ingest/syncs-table.tsx` (modify) | Accept `overrides`, use lib resolver, render `<SyncNameEdit>` |
| `src/components/data-ingest/sync-name-edit.tsx` (create) | Inline edit control (input + save/cancel/reset) |
| `src/lib/hightouch/sync-name-overrides.json` (delete) | Removed after migration seeds the DB |
| `tests/helpers/db.ts` (modify) | Add `syncNameOverride` cleanup to `truncateAll` |
| `tests/unit/sync-display-name.test.ts` (create) | Resolver unit tests |
| `tests/integration/sync-name-override.test.ts` (create) | Endpoint integration tests |
| `tests/regression/sync-rename-does-not-affect-trigger.test.ts` (create) | Invariant: trigger uses raw id |
| `tests/unit/sync-name-edit.test.tsx` (create) | Inline edit component test |

---

### Task 1: Add the `SyncNameOverride` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_sync_name_override/migration.sql`
- Modify: `tests/helpers/db.ts` (add cleanup to `truncateAll`)

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma` (place near other small lookup models):

```prisma
model SyncNameOverride {
  syncId      String   @id
  displayName String
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
}
```

- [ ] **Step 2: Create the migration folder + idempotent DDL**

Run to get a timestamp and create the folder:

```bash
TS=$(date +%Y%m%d%H%M%S); mkdir -p "prisma/migrations/${TS}_add_sync_name_override"; echo "prisma/migrations/${TS}_add_sync_name_override/migration.sql"
```

Write the printed `migration.sql` path with this content:

```sql
CREATE TABLE IF NOT EXISTS "SyncNameOverride" (
  "syncId"      TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncNameOverride_pkey" PRIMARY KEY ("syncId")
);

INSERT INTO "SyncNameOverride" ("syncId", "displayName", "updatedAt", "createdAt")
VALUES ('2770929', 'Push Opens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("syncId") DO NOTHING;
```

- [ ] **Step 3: Apply the DDL to the local test DB**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 \
  psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" \
  -f "$(ls -d prisma/migrations/*_add_sync_name_override)/migration.sql"
```

Expected: `CREATE TABLE` then `INSERT 0 1`.

- [ ] **Step 4: Apply the DDL to production**

`DATABASE_URL_UNPOOLED` lives in `.env.local`. Apply the same file against prod:

```bash
psql -v ON_ERROR_STOP=1 "$(grep -E '^DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')" \
  -f "$(ls -d prisma/migrations/*_add_sync_name_override)/migration.sql"
```

Expected: `CREATE TABLE` then `INSERT 0 1` (or `INSERT 0 0` if the row already existed).

- [ ] **Step 5: Reconcile migration history + regenerate client**

```bash
npx prisma migrate resolve --applied "$(ls prisma/migrations | grep _add_sync_name_override)"
npx prisma generate
git checkout -- apps/api/src/generated/prisma/ 2>/dev/null || true
```

Expected: "Migration ... marked as applied." and a successful generate.

- [ ] **Step 6: Add cleanup to `truncateAll`**

In `tests/helpers/db.ts`, inside `truncateAll()`, add this line next to the other optional-table cleanups (e.g. right after the `userSegment`/`segment` deletes):

```ts
  await prisma.syncNameOverride.deleteMany().catch(() => {});
```

- [ ] **Step 7: Smoke-test the model**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  bun -e 'import { prisma } from "@/lib/db"; const r = await prisma.syncNameOverride.upsert({ where: { syncId: "smoke" }, create: { syncId: "smoke", displayName: "x" }, update: { displayName: "x" } }); console.log(r.syncId, r.displayName); await prisma.syncNameOverride.delete({ where: { syncId: "smoke" } }); process.exit(0);'
```

Expected: prints `smoke x` with no error.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts
git commit -m "feat(db): add SyncNameOverride model + seed migration"
```

---

### Task 2: Pure name-resolution helper

**Files:**
- Create: `src/lib/hightouch/sync-display-name.ts`
- Test: `tests/unit/sync-display-name.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sync-display-name.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { syncDisplayName, humanizeSlug } from "@/lib/hightouch/sync-display-name";
import type { HightouchSync } from "@/lib/hightouch/types";

function makeSync(over: Partial<HightouchSync>): HightouchSync {
  return {
    id: "1", name: null, slug: "some-slug", status: "success", primaryKey: "id",
    modelId: "m", destinationId: "d", schedule: null, lastRunAt: null,
    createdAt: "", updatedAt: "", configuration: {}, ...over,
  };
}

describe("syncDisplayName", () => {
  it("returns the override when one exists for the sync id", () => {
    const sync = makeSync({ id: "2770929", name: "raw-name", slug: "raw-slug" });
    expect(syncDisplayName(sync, { "2770929": "Push Opens" })).toBe("Push Opens");
  });

  it("falls back to trimmed sync.name when no override", () => {
    const sync = makeSync({ id: "1", name: "  Daily Givers  ", slug: "daily-givers" });
    expect(syncDisplayName(sync, {})).toBe("Daily Givers");
  });

  it("falls back to humanized slug when no override and no name", () => {
    const sync = makeSync({ id: "1", name: null, slug: "all-givers-to-nexus" });
    expect(syncDisplayName(sync, {})).toBe("All Givers To Nexus");
  });

  it("upper-cases known abbreviations in the humanized slug", () => {
    expect(humanizeSlug("lapsed-wau-yv")).toBe("Lapsed WAU YV");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test tests/unit/sync-display-name.test.ts
```

Expected: FAIL — cannot resolve `@/lib/hightouch/sync-display-name`.

- [ ] **Step 3: Write the helper**

Create `src/lib/hightouch/sync-display-name.ts`:

```ts
import type { HightouchSync } from "@/lib/hightouch/types";

const ABBREVS = new Set(["wau", "mau", "dau", "ba", "en", "us", "uk", "id", "yv"]);

export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (ABBREVS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** DB override (by sync id) → trimmed sync.name → humanized slug. Display-only. */
export function syncDisplayName(sync: HightouchSync, overrides: Record<string, string>): string {
  const override = overrides[String(sync.id)];
  if (override) return override;
  return sync.name?.trim() || humanizeSlug(sync.slug);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test tests/unit/sync-display-name.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hightouch/sync-display-name.ts tests/unit/sync-display-name.test.ts
git commit -m "feat(hightouch): extract pure syncDisplayName resolver with unit tests"
```

---

### Task 3: Admin `PUT`/`DELETE` name endpoint

**Files:**
- Create: `src/app/api/hightouch/syncs/[id]/name/route.ts`
- Test: `tests/integration/sync-name-override.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/sync-name-override.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";

// Overridable auth so we can exercise the non-admin 403 path.
const mockAuth: { roles: string[] } = { roles: ["admin"] };
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the auth mock takes effect.
const { PUT, DELETE } = await import("@/app/api/hightouch/syncs/[id]/name/route");

function req(method: "PUT" | "DELETE", body?: unknown): Request {
  return new Request("http://localhost/api/hightouch/syncs/2770929/name", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const params = { params: Promise.resolve({ id: "2770929" }) };

beforeEach(async () => { await truncateAll(); mockAuth.roles = ["admin"]; });
afterEach(async () => { await truncateAll(); mockAuth.roles = ["admin"]; });

describe("PUT/DELETE /api/hightouch/syncs/[id]/name", () => {
  it("PUT creates an override and returns { data: { syncId, displayName } }", async () => {
    const res = await PUT(req("PUT", { displayName: "Push Opens" }), params);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { syncId: string; displayName: string } };
    expect(json.data).toEqual({ syncId: "2770929", displayName: "Push Opens" });

    const row = await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } });
    expect(row!.displayName).toBe("Push Opens");
  });

  it("PUT upserts (updates an existing override)", async () => {
    await prisma.syncNameOverride.create({ data: { syncId: "2770929", displayName: "Old" } });
    const res = await PUT(req("PUT", { displayName: "New Name" }), params);
    expect(res.status).toBe(200);
    const row = await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } });
    expect(row!.displayName).toBe("New Name");
  });

  it("PUT trims surrounding whitespace before storing", async () => {
    await PUT(req("PUT", { displayName: "  Trimmed  " }), params);
    const row = await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } });
    expect(row!.displayName).toBe("Trimmed");
  });

  it("PUT rejects empty / whitespace-only with 400", async () => {
    expect((await PUT(req("PUT", { displayName: "" }), params)).status).toBe(400);
    expect((await PUT(req("PUT", { displayName: "   " }), params)).status).toBe(400);
  });

  it("PUT rejects a non-string or over-long name with 400", async () => {
    expect((await PUT(req("PUT", { displayName: 123 }), params)).status).toBe(400);
    expect((await PUT(req("PUT", { displayName: "x".repeat(101) }), params)).status).toBe(400);
  });

  it("PUT rejects a non-admin caller with 403 before any write", async () => {
    mockAuth.roles = [];
    const res = await PUT(req("PUT", { displayName: "Nope" }), params);
    expect(res.status).toBe(403);
    expect(await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } })).toBeNull();
  });

  it("DELETE clears the override and returns { data: { syncId } }", async () => {
    await prisma.syncNameOverride.create({ data: { syncId: "2770929", displayName: "Old" } });
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { syncId: string } };
    expect(json.data).toEqual({ syncId: "2770929" });
    expect(await prisma.syncNameOverride.findUnique({ where: { syncId: "2770929" } })).toBeNull();
  });

  it("DELETE is idempotent (200 when no override exists)", async () => {
    expect((await DELETE(req("DELETE"), params)).status).toBe(200);
  });

  it("DELETE rejects a non-admin caller with 403", async () => {
    mockAuth.roles = [];
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  bun test tests/integration/sync-name-override.test.ts
```

Expected: FAIL — cannot resolve `@/app/api/hightouch/syncs/[id]/name/route`.

- [ ] **Step 3: Write the route handler**

Create `src/app/api/hightouch/syncs/[id]/name/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

const MAX_NAME_LEN = 100;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<{ data: { syncId: string; displayName: string } } | { error: string }>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400);
  }

  const raw = (body as Record<string, unknown> | null)?.displayName;
  if (typeof raw !== "string") return fail("displayName must be a string", 400);
  const displayName = raw.trim();
  if (displayName.length === 0) return fail("displayName must not be empty", 400);
  if (displayName.length > MAX_NAME_LEN) return fail(`displayName must be ${MAX_NAME_LEN} characters or fewer`, 400);

  try {
    await prisma.syncNameOverride.upsert({
      where: { syncId: id },
      create: { syncId: id, displayName },
      update: { displayName },
    });
    return ok({ syncId: id, displayName });
  } catch (err) {
    return handleRouteError(`PUT /api/hightouch/syncs/${id}/name`, err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<{ data: { syncId: string } } | { error: string }>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;
  try {
    await prisma.syncNameOverride.deleteMany({ where: { syncId: id } });
    return ok({ syncId: id });
  } catch (err) {
    return handleRouteError(`DELETE /api/hightouch/syncs/${id}/name`, err);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  bun test tests/integration/sync-name-override.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/hightouch/syncs/[id]/name/route.ts" tests/integration/sync-name-override.test.ts
git commit -m "feat(api): admin PUT/DELETE sync display-name override endpoint"
```

---

### Task 4: Server data flow + resolver swap + delete JSON

**Files:**
- Modify: `src/app/data-ingest/page.tsx`
- Modify: `src/components/data-ingest/syncs-table.tsx`
- Delete: `src/lib/hightouch/sync-name-overrides.json`
- Test: `tests/regression/sync-rename-does-not-affect-trigger.test.ts`

- [ ] **Step 1: Write the failing regression test (trigger invariant)**

Create `tests/regression/sync-rename-does-not-affect-trigger.test.ts`:

```ts
// Regression (spec 2026-06-08-sync-display-name-rename): a custom display name is
// display-only. Triggering must always call the Hightouch client with the raw
// sync id from the route param, never the renamed display string. This pins the
// invariant so a future change can't leak the display name into the trigger path.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";

const mockAuth = { roles: ["admin"] as string[] };
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
      roles: mockAuth.roles, sessionId: "s", accessToken: "t",
    }),
  signOut: async () => {},
}));

const triggerCalls: string[] = [];
mock.module("@/lib/hightouch/client", () => ({
  createHightouchClient: () => ({
    triggerSync: async (id: string) => { triggerCalls.push(id); return { id: "run1" }; },
  }),
}));

const { POST: triggerSync } = await import("@/app/api/hightouch/syncs/[id]/trigger/route");

beforeEach(async () => { await truncateAll(); triggerCalls.length = 0; });
afterEach(async () => { await truncateAll(); });

describe("renaming a sync never changes the id used to trigger it", () => {
  it("triggers with the raw sync id even when a display override exists", async () => {
    await prisma.syncNameOverride.create({ data: { syncId: "2770929", displayName: "Push Opens" } });

    const req = new Request("http://localhost/api/hightouch/syncs/2770929/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await triggerSync(req as never, { params: Promise.resolve({ id: "2770929" }) });
    expect(res.status).toBe(200);
    expect(triggerCalls).toEqual(["2770929"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  bun test tests/regression/sync-rename-does-not-affect-trigger.test.ts
```

Expected: FAIL — `prisma.syncNameOverride` exists (Task 1), but if Task 1 was skipped this errors; otherwise the test should actually PASS already because the trigger route is unchanged. This test is a **guard** (it documents the invariant and will pass on green code). If it passes immediately, that is the expected end state — proceed. If it fails, the trigger route has a latent bug to fix before continuing.

- [ ] **Step 3: Add `getCachedOverrides` to the page and thread it through**

In `src/app/data-ingest/page.tsx`:

Add the import near the existing imports:

```ts
import { prisma } from "@/lib/db";
```

Add a cache wrapper alongside the others (after `getCachedDestinations`):

```ts
const getCachedOverrides = cache(async (): Promise<Record<string, string>> => {
  try {
    const rows = await prisma.syncNameOverride.findMany({ select: { syncId: true, displayName: true } });
    return Object.fromEntries(rows.map((r) => [r.syncId, r.displayName]));
  } catch {
    return {};
  }
});
```

Update `SyncsSection` to fetch and pass overrides:

```tsx
async function SyncsSection() {
  const [{ syncs, error }, models, destinations, overrides] = await Promise.all([
    getCachedSyncs(),
    getCachedModels(),
    getCachedDestinations(),
    getCachedOverrides(),
  ]);
  return (
    <SyncsTable
      syncs={syncs}
      models={models}
      destinations={destinations}
      overrides={overrides}
      hasApiKey={!!process.env.HIGHTOUCH_API_KEY}
      apiError={error}
    />
  );
}
```

Add a pre-kick line in `DataIngestPage` next to the other `void` calls:

```tsx
  void getCachedOverrides();
```

- [ ] **Step 4: Switch `syncs-table.tsx` to the lib resolver + `overrides` prop**

In `src/components/data-ingest/syncs-table.tsx`:

Replace the JSON import and local helpers. Remove these lines:

```ts
import SYNC_NAME_OVERRIDES from "@/lib/hightouch/sync-name-overrides.json";
```
and the local `ABBREVS`, `humanizeSlug`, and `syncDisplayName` definitions (lines defining them).

Add the import:

```ts
import { syncDisplayName } from "@/lib/hightouch/sync-display-name";
```

Add `overrides` to `SyncsTableProps`:

```ts
type SyncsTableProps = {
  syncs: HightouchSync[];
  models: HightouchModel[];
  destinations: HightouchDestination[];
  overrides: Record<string, string>;
  hasApiKey: boolean;
  apiError?: string;
};
```

Add `overrides` to `SyncItemProps` and destructure it in both `SyncCard` and `SyncTableRow`:

```ts
type SyncItemProps = {
  sync: HightouchSync;
  modelName: string;
  destName: string;
  overrides: Record<string, string>;
};
```

In `SyncCard` and `SyncTableRow`, change `const displayName = syncDisplayName(sync);` to:

```ts
const displayName = syncDisplayName(sync, overrides);
```

In the main `SyncsTable`, destructure `overrides` from props, and update the three call sites inside the `useMemo`s that call `syncDisplayName(s)` / `syncDisplayName(a)` / `syncDisplayName(b)` to pass `overrides` as the second arg. Add `overrides` to the dependency arrays of the `scoped` and `filtered` `useMemo`s.

Pass `overrides={overrides}` into every `<SyncCard ... />` and `<SyncTableRow ... />` render (both the mobile `.map` and the desktop `.map`).

- [ ] **Step 5: Delete the JSON file**

```bash
git rm src/lib/hightouch/sync-name-overrides.json
```

- [ ] **Step 6: Verify typecheck + regression test + no stale JSON refs**

```bash
bun run typecheck
grep -rn "sync-name-overrides" src/ || echo "no stale refs (good)"
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  bun test tests/regression/sync-rename-does-not-affect-trigger.test.ts
```

Expected: typecheck passes, no stale refs, regression test PASSES.

- [ ] **Step 7: Commit**

```bash
git add src/app/data-ingest/page.tsx src/components/data-ingest/syncs-table.tsx tests/regression/sync-rename-does-not-affect-trigger.test.ts
git commit -m "feat(data-ingest): DB-backed sync display names; remove static JSON overrides"
```

---

### Task 5: Inline edit control

**Files:**
- Create: `src/components/data-ingest/sync-name-edit.tsx`
- Modify: `src/components/data-ingest/syncs-table.tsx`
- Test: `tests/unit/sync-name-edit.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/sync-name-edit.test.tsx`:

```tsx
import { afterEach, describe, expect, it, mock, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SyncNameEdit } from "@/components/data-ingest/sync-name-edit";

const fetchCalls: { url: string; method: string; body: string | null }[] = [];

beforeEach(() => {
  fetchCalls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string) ?? null });
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => cleanup());

describe("SyncNameEdit", () => {
  it("shows the current name and reveals an input on edit", () => {
    render(<SyncNameEdit syncId="123" currentName="Push Opens" defaultName="Opens Wau" />);
    expect(screen.getByText("Push Opens")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    expect(screen.getByDisplayValue("Push Opens")).toBeInTheDocument();
  });

  it("PUTs the trimmed new name on save", async () => {
    render(<SyncNameEdit syncId="123" currentName="Old" defaultName="Old" />);
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  New Name  " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0]!.url).toBe("/api/hightouch/syncs/123/name");
    expect(fetchCalls[0]!.method).toBe("PUT");
    expect(JSON.parse(fetchCalls[0]!.body!)).toEqual({ displayName: "New Name" });
  });

  it("DELETEs (reset) when the input is cleared and saved", async () => {
    render(<SyncNameEdit syncId="123" currentName="Push Opens" defaultName="Opens Wau" />);
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0]!.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test tests/unit/sync-name-edit.test.tsx
```

Expected: FAIL — cannot resolve `@/components/data-ingest/sync-name-edit`.

- [ ] **Step 3: Write the component**

Create `src/components/data-ingest/sync-name-edit.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  syncId: string;
  currentName: string;
  defaultName: string;
};

export function SyncNameEdit({ syncId, currentName, defaultName }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setValue(name);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = value.trim();
    setBusy(true);
    setError(null);
    try {
      // Clearing the field resets to the default (DELETE the override).
      const res = trimmed.length === 0
        ? await fetch(`/api/hightouch/syncs/${syncId}/name`, { method: "DELETE" })
        : await fetch(`/api/hightouch/syncs/${syncId}/name`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ displayName: trimmed }),
          });
      if (!res.ok) {
        setError("Could not save");
        return;
      }
      setName(trimmed.length === 0 ? defaultName : trimmed);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1.5 min-w-0">
        <span className="truncate">{name}</span>
        <button
          type="button"
          aria-label="Edit name"
          onClick={(e) => { e.stopPropagation(); open(); }}
          className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          placeholder={defaultName}
          className="h-7 text-xs w-44"
        />
        <button type="button" aria-label="Save" disabled={busy} onClick={save} className="shrink-0 text-green-600 hover:text-green-700 disabled:opacity-50">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Cancel" disabled={busy} onClick={() => setEditing(false)} className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
      <span className={cn("text-[10px]", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? "Display-only — does not affect sync triggering. Clear to reset."}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test tests/unit/sync-name-edit.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Wire `SyncNameEdit` into both row variants**

In `src/components/data-ingest/syncs-table.tsx`:

Add the import:

```ts
import { SyncNameEdit } from "./sync-name-edit";
```

In `SyncCard`, replace the name paragraph:

```tsx
<p className="text-sm font-medium truncate leading-tight">{displayName}</p>
```

with:

```tsx
<div className="text-sm font-medium leading-tight" onClick={(e) => e.stopPropagation()}>
  <SyncNameEdit syncId={String(sync.id)} currentName={displayName} defaultName={syncDisplayName(sync, {})} />
</div>
```

In `SyncTableRow`, replace the name button:

```tsx
<button
  type="button"
  className="text-xs font-medium hover:underline text-left"
  onClick={() => setDrawerOpen(true)}
>
  {displayName}
</button>
```

with:

```tsx
<span className="text-xs font-medium">
  <SyncNameEdit syncId={String(sync.id)} currentName={displayName} defaultName={syncDisplayName(sync, {})} />
</span>
```

(Run-history is still reachable via the row's other controls and the mobile "View run history" link; the name is now an edit affordance rather than a drawer trigger.)

- [ ] **Step 6: Verify typecheck + the component test + existing syncs tests**

```bash
bun run typecheck
bun test tests/unit/sync-name-edit.test.tsx tests/unit/sync-display-name.test.ts
```

Expected: typecheck passes; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/data-ingest/sync-name-edit.tsx src/components/data-ingest/syncs-table.tsx tests/unit/sync-name-edit.test.tsx
git commit -m "feat(data-ingest): inline edit control for sync display names"
```

---

### Task 6: Full check + MR

**Files:** none (verification + ship)

- [ ] **Step 1: Run the full check suite**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  bun run check
```

Expected: typecheck + lint + full test suite all green (the pre-existing `api-helpers.test.ts` "secret internal detail" console line is intentional output, not a failure).

- [ ] **Step 2: Push the branch and open the MR**

```bash
git push -u origin HEAD
glab mr create --fill --yes
```

- [ ] **Step 3: Poll for mergeable, then merge**

Poll `glab mr view <N> --output json | jq -r '.detailed_merge_status'` until `mergeable`, then:

```bash
glab mr merge <N> --yes
```

---

## Self-Review

**1. Spec coverage**
- Data model + migration + seed + JSON delete → Task 1 + Task 4 Step 5. ✓
- Resolver helper (DB → name → slug) → Task 2. ✓
- Server data flow (`getCachedOverrides`, prop threading, `force-dynamic` re-read) → Task 4. ✓
- Admin `PUT`/`DELETE` endpoint with validate-before-DB, envelope, idempotent DELETE → Task 3. ✓
- Inline edit UX (pencil, save/cancel/reset, empty=reset, optimistic + `router.refresh()`, helper text) → Task 5. ✓
- Triggering untouched / invariant test → Task 4 Step 1. ✓
- Search & sort use the resolver with overrides → Task 4 Step 4. ✓
- Tests: unit (resolver + component), integration (endpoint), regression (trigger invariant) → Tasks 2,3,4,5. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every code step has full content. Migration timestamp is generated by an exact command. ✓

**3. Type consistency:** `syncDisplayName(sync, overrides)` signature is identical across helper, tests, page wiring, and component call sites. `SyncNameEdit` props `{ syncId, currentName, defaultName }` match between component, tests, and both row call sites. Endpoint returns `{ data: { syncId, displayName } }` (PUT) / `{ data: { syncId } }` (DELETE), matching the integration test assertions. ✓

**Note on Task 4 Step 1/2:** the trigger-invariant regression test is a guard that should pass on correct code rather than fail-first (the trigger route is intentionally unchanged). This is called out explicitly in the step so the implementer doesn't treat an immediate pass as an error.
