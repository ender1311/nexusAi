# C2 — Audience › Sizes Overview + Exact-Count Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/audience/sizes` — a single table listing every saved rule-segment and every Hightouch-imported segment with its audience size — and persist expensive exact counts for rule-segments in the database so they survive deploys and can be refreshed on demand.

**Architecture:** A `force-dynamic` server page fetches rule-segments (with cached exact counts) + computes cheap live planner estimates in parallel, fetches Hightouch segment sizes from the existing cache, and merges them via a pure mapper into one sorted row model. A client table renders them with a Type badge and, on rule rows only, single-row + sequential "Refresh all" buttons that POST to an admin-gated endpoint which runs the exact `COUNT(*)` and persists it to two new `Segment` columns.

**Tech Stack:** Next.js 16 App Router (server + client components), React 19, TypeScript (strict, no `any`), Prisma v7 + PostgreSQL (Neon prod / local `nexus_test`), Bun test runner, shadcn/ui table, lucide-react.

**Branch:** `feat/audience-segments-c2` (already cut off the merged `origin/main`; the C2 design spec commit is already on it).

**Spec:** `docs/superpowers/specs/2026-06-07-segments-sizes-c2-design.md`

---

## File Structure

- **Create** `prisma/migrations/20260607170000_add_segment_size_cache/migration.sql` — idempotent DDL adding `sizeExact` + `sizeComputedAt`.
- **Modify** `prisma/schema.prisma:535-545` — add the two columns to the `Segment` model.
- **Create** `src/lib/segments/size-rows.ts` — pure `mergeSegmentSizeRows` mapper + the `safeEstimateForRule` page-assembly helper (the one I/O helper, kept thin).
- **Create** `src/app/api/segment-definitions/[id]/refresh-size/route.ts` — admin-gated POST that computes + persists the exact count.
- **Create** `src/components/segments/segment-sizes-table.tsx` — client table (Type badge, size cell, single-row Refresh, Refresh-all).
- **Modify** `src/app/audience/sizes/page.tsx` — replace `<ComingSoon />` with the real page.
- **Create** tests: `tests/unit/segment-size-rows.test.ts`, `tests/regression/sizes-corrupt-rule-estimate.test.ts`, `tests/integration/segment-refresh-size.test.ts`, `tests/integration/segment-refresh-size-forbidden.test.ts`, `tests/regression/segment-sizes-table.test.tsx`.

### Pre-existing pieces this plan consumes (do NOT reimplement)
- `src/lib/segments/parse-rule.ts` → `parseSegmentRule(value: unknown): SegmentRule | null`
- `src/lib/segments/compile-sql.ts` → `compileSegmentRule(rule: SegmentRule): CompiledWhere`
- `src/lib/segments/sizing.ts` → `estimateSegmentSize(where): Promise<number>`, `exactSegmentSize(where): Promise<ExactResult>` where `ExactResult = { count: number; timedOut: false } | { count: null; timedOut: true }`
- `src/lib/cache/segments.ts` → `getCachedSegments(): Promise<SegmentInfo[]>`, `SegmentInfo = { name: string; userCount: number; assignedTo: string | null }`
- `src/lib/api/respond.ts` → `ok(data, status?)`, `fail(message, status)`, `handleRouteError(context, err)`
- `src/lib/auth.ts` → `requireAdmin(): Promise<NextResponse | null>`
- `src/lib/utils.ts` → `formatNumber(n)`, `formatRelativeTime(dateStr: string | null)`
- `tests/helpers/`: `buildRequest(method, body?, headers?)`, `createUser(externalId, attributes?)`, `createUserSegment(externalId, segmentName)`, `truncateAll()`, `prisma`
- **Test auth:** `tests/setup/bun.ts` globally mocks `@workos-inc/authkit-nextjs` `withAuth` to an **admin** session, so integration tests pass `requireAdmin()` by default. Override `withAuth` (roles `[]`) in a dedicated file to test the 403 path.

---

## Task 1: Schema — add exact-count cache columns

**Files:**
- Modify: `prisma/schema.prisma:535-545`
- Create: `prisma/migrations/20260607170000_add_segment_size_cache/migration.sql`

- [ ] **Step 1: Add the columns to the Prisma model**

Edit `prisma/schema.prisma` so the `Segment` model reads:

```prisma
model Segment {
  id             String    @id @default(cuid())
  name           String    @unique
  description    String?
  rule           Json
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  createdBy      String?
  sizeExact      Int?
  sizeComputedAt DateTime?

  @@map("Segment")
}
```

- [ ] **Step 2: Write the idempotent migration SQL**

Create `prisma/migrations/20260607170000_add_segment_size_cache/migration.sql`:

```sql
-- C2: durable exact-count cache for rule-segments.
ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "sizeExact" INTEGER;
ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "sizeComputedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Apply the DDL to the local test DB**

Run (PG* env override per repo convention, so it targets local `nexus_test` not prod):

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT \
  PGUSER="$(whoami)" PGPASSWORD="" \
  psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" \
  -f prisma/migrations/20260607170000_add_segment_size_cache/migration.sql
```

Expected: `ALTER TABLE` printed twice, no error.

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" — `prisma.segment` now exposes `sizeExact` / `sizeComputedAt`.

- [ ] **Step 5: Verify the client picks up the columns**

Run: `bun run typecheck`
Expected: exits 0 (no errors — the new fields are valid; nothing references them yet).

> **PROD APPLY IS DEFERRED TO SHIP TIME.** Do NOT run `prisma migrate dev`/`db push` against any DB (prisma.config.ts loads `.env.local` = PROD). At ship time, apply the same `migration.sql` to prod via the unpooled connection, then `prisma migrate resolve --applied 20260607170000_add_segment_size_cache`, then confirm `prisma migrate status` is clean. This task only touches the local test DB.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260607170000_add_segment_size_cache/migration.sql
git commit -m "feat(segments): add Segment.sizeExact/sizeComputedAt exact-count cache columns"
```

---

## Task 2: Pure mapper — `mergeSegmentSizeRows`

**Files:**
- Create: `src/lib/segments/size-rows.ts`
- Test: `tests/unit/segment-size-rows.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/segment-size-rows.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mergeSegmentSizeRows, bestSize, type RuleSegInput, type HtSegInput } from "@/lib/segments/size-rows";

const baseRule = (over: Partial<RuleSegInput>): RuleSegInput => ({
  id: "s1", name: "Rule A", description: null, estimate: 100,
  sizeExact: null, sizeComputedAt: null, updatedAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

describe("mergeSegmentSizeRows", () => {
  it("tags each source with its kind and serializes dates to ISO strings", () => {
    const rows = mergeSegmentSizeRows(
      [baseRule({ sizeComputedAt: new Date("2026-06-02T03:04:05Z") })],
      [{ name: "ht-seg", userCount: 5, assignedTo: "Agent X" }],
    );
    const rule = rows.find((r) => r.kind === "rule")!;
    const ht = rows.find((r) => r.kind === "hightouch")!;
    expect(rule.kind).toBe("rule");
    expect(ht.kind).toBe("hightouch");
    if (rule.kind === "rule") {
      expect(rule.sizeComputedAt).toBe("2026-06-02T03:04:05.000Z");
      expect(rule.updatedAt).toBe("2026-06-01T00:00:00.000Z");
    }
  });

  it("prefers exact over estimate as the sort key, descending", () => {
    const rows = mergeSegmentSizeRows(
      [
        baseRule({ id: "small", name: "Small", estimate: 10, sizeExact: 10 }),
        baseRule({ id: "bigexact", name: "BigExact", estimate: 50, sizeExact: 9000 }),
      ],
      [{ name: "ht-mid", userCount: 1000, assignedTo: null }],
    );
    expect(rows.map((r) => r.name)).toEqual(["BigExact", "ht-mid", "Small"]);
  });

  it("falls back to estimate when sizeExact is null", () => {
    const row = mergeSegmentSizeRows([baseRule({ estimate: 777, sizeExact: null })], [])[0];
    expect(bestSize(row)).toBe(777);
  });

  it("sorts a rule with both sizes null (invalid rule) last", () => {
    const rows = mergeSegmentSizeRows(
      [
        baseRule({ id: "invalid", name: "Invalid", estimate: null, sizeExact: null }),
        baseRule({ id: "ok", name: "Ok", estimate: 5, sizeExact: null }),
      ],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(["Ok", "Invalid"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/segment-size-rows.test.ts`
Expected: FAIL — `Cannot find module "@/lib/segments/size-rows"`.

- [ ] **Step 3: Implement the pure mapper**

Create `src/lib/segments/size-rows.ts`:

```ts
export type RuleSegInput = {
  id: string;
  name: string;
  description: string | null;
  estimate: number | null;
  sizeExact: number | null;
  sizeComputedAt: Date | null;
  updatedAt: Date;
};

export type HtSegInput = { name: string; userCount: number; assignedTo: string | null };

export type SizeRow =
  | {
      kind: "rule";
      id: string;
      name: string;
      description: string | null;
      estimate: number | null;
      sizeExact: number | null;
      sizeComputedAt: string | null;
      updatedAt: string;
    }
  | { kind: "hightouch"; name: string; userCount: number; assignedTo: string | null };

/** Best-available size used as the sort key. Invalid rule rows (no size) sort last. */
export function bestSize(row: SizeRow): number {
  if (row.kind === "hightouch") return row.userCount;
  return row.sizeExact ?? row.estimate ?? -1;
}

/** Merge rule-segments + Hightouch segments into one row model sorted by size, desc. Pure. */
export function mergeSegmentSizeRows(ruleSegs: RuleSegInput[], htSegs: HtSegInput[]): SizeRow[] {
  const rows: SizeRow[] = [
    ...ruleSegs.map(
      (r): SizeRow => ({
        kind: "rule",
        id: r.id,
        name: r.name,
        description: r.description,
        estimate: r.estimate,
        sizeExact: r.sizeExact,
        sizeComputedAt: r.sizeComputedAt ? r.sizeComputedAt.toISOString() : null,
        updatedAt: r.updatedAt.toISOString(),
      }),
    ),
    ...htSegs.map(
      (h): SizeRow => ({ kind: "hightouch", name: h.name, userCount: h.userCount, assignedTo: h.assignedTo }),
    ),
  ];
  return rows.sort((a, b) => bestSize(b) - bestSize(a));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/segment-size-rows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/size-rows.ts tests/unit/segment-size-rows.test.ts
git commit -m "feat(segments): pure mergeSegmentSizeRows mapper for the sizes table"
```

---

## Task 3: Page-assembly helper — `safeEstimateForRule`

**Files:**
- Modify: `src/lib/segments/size-rows.ts`
- Test: `tests/regression/sizes-corrupt-rule-estimate.test.ts`

- [ ] **Step 1: Write the failing regression test**

Create `tests/regression/sizes-corrupt-rule-estimate.test.ts`:

```ts
// Regression: a corrupt/unparseable Segment.rule must not crash sizes-page assembly.
// It should resolve to a null estimate (no DB call, no throw) so the row renders "invalid rule".
// See docs/superpowers/specs/2026-06-07-segments-sizes-c2-design.md (Error handling).
import { describe, expect, it } from "bun:test";
import { safeEstimateForRule } from "@/lib/segments/size-rows";

describe("safeEstimateForRule — corrupt rule", () => {
  it("returns null for a garbage object without throwing", async () => {
    expect(await safeEstimateForRule({ totally: "not a rule" })).toBeNull();
  });

  it("returns null for null", async () => {
    expect(await safeEstimateForRule(null)).toBeNull();
  });

  it("returns null for a condition with an unknown field", async () => {
    const rule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "nope", operator: "eq", value: 1 }] };
    expect(await safeEstimateForRule(rule)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/regression/sizes-corrupt-rule-estimate.test.ts`
Expected: FAIL — `safeEstimateForRule` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/lib/segments/size-rows.ts`:

```ts
import { parseSegmentRule } from "./parse-rule";
import { compileSegmentRule } from "./compile-sql";
import { estimateSegmentSize } from "./sizing";

/**
 * Live planner estimate for a stored rule. Returns null when the rule is corrupt
 * or unparseable — parseSegmentRule short-circuits BEFORE any DB call, so a bad
 * row never throws and never touches Postgres.
 */
export async function safeEstimateForRule(rule: unknown): Promise<number | null> {
  const parsed = parseSegmentRule(rule);
  if (parsed === null) return null;
  return estimateSegmentSize(compileSegmentRule(parsed));
}
```

> Put the three imports at the TOP of the file (move them above the type declarations) to satisfy lint's import-ordering. The corrupt-rule test exercises only the `parsed === null` branch, so no DB is required for it to pass.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/regression/sizes-corrupt-rule-estimate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/size-rows.ts tests/regression/sizes-corrupt-rule-estimate.test.ts
git commit -m "feat(segments): safeEstimateForRule helper tolerant of corrupt rules"
```

---

## Task 4: Refresh-size endpoint

**Files:**
- Create: `src/app/api/segment-definitions/[id]/refresh-size/route.ts`
- Test: `tests/integration/segment-refresh-size.test.ts`, `tests/integration/segment-refresh-size-forbidden.test.ts`

- [ ] **Step 1: Write the failing integration test (happy / 404 / 400)**

Create `tests/integration/segment-refresh-size.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createUser } from "../helpers/builders";
import { POST } from "@/app/api/segment-definitions/[id]/refresh-size/route";

const wauRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST /api/segment-definitions/[id]/refresh-size", () => {
  it("computes the exact count and persists it on the Segment row", async () => {
    await createUser("u1", { funnelStage: "wau" });
    await createUser("u2", { funnelStage: "wau" });
    await createUser("u3", { funnelStage: "mau" });
    const seg = await prisma.segment.create({ data: { name: "WAU", rule: wauRule } });

    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: seg.id }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.count).toBe(2);
    expect(json.data.timedOut).toBe(false);
    expect(typeof json.data.computedAt).toBe("string");

    const after = await prisma.segment.findUnique({ where: { id: seg.id } });
    expect(after?.sizeExact).toBe(2);
    expect(after?.sizeComputedAt).not.toBeNull();
  });

  it("returns 404 when the segment does not exist", async () => {
    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the stored rule is corrupt", async () => {
    const seg = await prisma.segment.create({ data: { name: "Bad", rule: { junk: true } } });
    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: seg.id }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/integration/segment-refresh-size.test.ts`
Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/segment-definitions/[id]/refresh-size/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { exactSegmentSize } from "@/lib/segments/sizing";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    const seg = await prisma.segment.findUnique({ where: { id } });
    if (!seg) return fail("Segment not found", 404);

    const rule = parseSegmentRule(seg.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    const result = await exactSegmentSize(compileSegmentRule(rule));
    if (result.timedOut) {
      // Do NOT overwrite a prior good value with null on timeout.
      return ok({ count: null, computedAt: null, timedOut: true as const });
    }

    const computedAt = new Date();
    await prisma.segment.update({
      where: { id },
      data: { sizeExact: result.count, sizeComputedAt: computedAt },
    });
    return ok({ count: result.count, computedAt: computedAt.toISOString(), timedOut: false as const });
  } catch (err) {
    return handleRouteError("POST /api/segment-definitions/[id]/refresh-size", err);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/integration/segment-refresh-size.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing 403 test in its own file**

Create `tests/integration/segment-refresh-size-forbidden.test.ts` (overrides the global admin mock with a roleless session BEFORE importing the route):

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Override the global admin mock from tests/setup/bun.ts: a session with no roles.
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => ({ user: { id: "u", email: "u@youversion.com", firstName: "U", lastName: "Ser" }, roles: [] }),
  signOut: () => Promise.resolve(),
}));

const { truncateAll, prisma } = await import("../helpers/db");
const { buildRequest } = await import("../helpers/request");
const { POST } = await import("@/app/api/segment-definitions/[id]/refresh-size/route");

const wauRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST refresh-size — auth", () => {
  it("returns 403 for a non-admin session", async () => {
    const seg = await prisma.segment.create({ data: { name: "WAU", rule: wauRule } });
    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: seg.id }) });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run the 403 test to verify it passes**

Run: `bun test tests/integration/segment-refresh-size-forbidden.test.ts`
Expected: PASS (1 test, status 403). (No new code needed — `requireAdmin()` already returns 403; this test proves the gate is wired.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/segment-definitions/[id]/refresh-size/route.ts tests/integration/segment-refresh-size.test.ts tests/integration/segment-refresh-size-forbidden.test.ts
git commit -m "feat(api/segment-definitions): admin-gated refresh-size endpoint persists exact count"
```

---

## Task 5: Client table component

**Files:**
- Create: `src/components/segments/segment-sizes-table.tsx`
- Test: `tests/regression/segment-sizes-table.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/regression/segment-sizes-table.test.tsx`:

```tsx
// Regression: the sizes table renders the right size affordance per row kind/state,
// and exposes Refresh controls only on rule rows.
// See docs/superpowers/specs/2026-06-07-segments-sizes-c2-design.md (Unified table).
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentSizesTable } from "@/components/segments/segment-sizes-table";
import type { SizeRow } from "@/lib/segments/size-rows";

const rows: SizeRow[] = [
  { kind: "rule", id: "a", name: "Exact Rule", description: null, estimate: 50, sizeExact: 1234567, sizeComputedAt: "2026-06-06T00:00:00.000Z", updatedAt: "2026-06-06T00:00:00.000Z" },
  { kind: "rule", id: "b", name: "Estimate Rule", description: null, estimate: 4200, sizeExact: null, sizeComputedAt: null, updatedAt: "2026-06-06T00:00:00.000Z" },
  { kind: "rule", id: "c", name: "Invalid Rule", description: null, estimate: null, sizeExact: null, sizeComputedAt: null, updatedAt: "2026-06-06T00:00:00.000Z" },
  { kind: "hightouch", name: "ht-seg", userCount: 9000, assignedTo: "Agent X" },
];

describe("SegmentSizesTable", () => {
  it("shows the exact value for a rule row that has a cached exact count", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("1.2M"); // formatNumber(1234567)
    expect(html).toContain("Exact Rule");
  });

  it("shows an approximate marker for an estimate-only rule row", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("≈");
    expect(html).toContain("4.2K"); // formatNumber(4200)
  });

  it("shows an invalid-rule marker when both sizes are null", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("invalid rule");
  });

  it("renders Hightouch rows with their member count and a Hightouch badge", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("ht-seg");
    expect(html).toContain("9.0K"); // formatNumber(9000) → "9.0K"
    expect(html).toContain("Hightouch");
  });

  it("renders a Refresh all control when at least one rule row exists", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={rows} />);
    expect(html).toContain("Refresh all");
  });

  it("renders an empty state when there are no rows", () => {
    const html = renderToStaticMarkup(<SegmentSizesTable rows={[]} />);
    expect(html).toContain("No segments yet");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/regression/segment-sizes-table.test.tsx`
Expected: FAIL — cannot find `@/components/segments/segment-sizes-table`.

- [ ] **Step 3: Implement the client table**

Create `src/components/segments/segment-sizes-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import type { SizeRow } from "@/lib/segments/size-rows";

function SizeCell({ row }: { row: SizeRow }) {
  if (row.kind === "hightouch") return <span className="font-medium">{formatNumber(row.userCount)}</span>;
  if (row.sizeExact !== null) {
    return (
      <span className="font-medium">
        {formatNumber(row.sizeExact)}
        <span className="ml-2 text-xs text-muted-foreground">exact · {formatRelativeTime(row.sizeComputedAt)}</span>
      </span>
    );
  }
  if (row.estimate !== null) {
    return (
      <span className="font-medium">
        ≈ {formatNumber(row.estimate)}
        <span className="ml-2 text-xs text-muted-foreground">estimate</span>
      </span>
    );
  }
  return <span className="text-xs text-destructive">invalid rule</span>;
}

export function SegmentSizesTable({ rows }: { rows: SizeRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const ruleIds = rows.filter((r): r is Extract<SizeRow, { kind: "rule" }> => r.kind === "rule").map((r) => r.id);

  async function refreshOne(id: string): Promise<void> {
    const res = await fetch(`/api/segment-definitions/${id}/refresh-size`, { method: "POST" });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  }

  async function handleRefresh(id: string) {
    setBusyId(id);
    try {
      await refreshOne(id);
      router.refresh();
    } catch {
      // non-blocking; the row keeps its prior value
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshAll() {
    setProgress(`0/${ruleIds.length}`);
    for (let i = 0; i < ruleIds.length; i++) {
      try {
        await refreshOne(ruleIds[i]); // sequential: one COUNT at a time, never parallel
      } catch {
        // skip a failed/timed-out row and continue
      }
      setProgress(`${i + 1}/${ruleIds.length}`);
    }
    setProgress(null);
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No segments yet.{" "}
        <Link href="/audience/segments" className="text-primary underline">
          Build one in the segment builder
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ruleIds.length > 0 && (
        <div className="flex items-center justify-end gap-3">
          {progress && <span className="text-xs text-muted-foreground">Refreshing {progress}…</span>}
          <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={progress !== null}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh all
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.kind === "rule" ? row.id : `ht-${row.name}`}>
              <TableCell>
                <div className="font-medium">{row.name}</div>
                {row.kind === "rule" && row.description && (
                  <div className="text-xs text-muted-foreground">{row.description}</div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={row.kind === "rule" ? "default" : "secondary"}>
                  {row.kind === "rule" ? "Rule" : "Hightouch"}
                </Badge>
              </TableCell>
              <TableCell><SizeCell row={row} /></TableCell>
              <TableCell className="text-right">
                {row.kind === "rule" && (
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleRefresh(row.id)} disabled={busyId === row.id || progress !== null}>
                      <RefreshCw className={`h-4 w-4 ${busyId === row.id ? "animate-spin" : ""}`} />
                    </Button>
                    <Link href="/audience/segments" className="text-xs text-primary underline">
                      Edit in builder
                    </Link>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

> If `@/components/ui/button` or `@/components/ui/badge` exports differ, check the actual export names before adjusting — both are standard shadcn components already used elsewhere in the repo (e.g. `src/components/segments/segment-builder.tsx`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/regression/segment-sizes-table.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/segments/segment-sizes-table.tsx tests/regression/segment-sizes-table.test.tsx
git commit -m "feat(segments): sizes table with per-row + sequential Refresh-all"
```

---

## Task 6: Wire up the `/audience/sizes` page

**Files:**
- Modify: `src/app/audience/sizes/page.tsx`

- [ ] **Step 1: Replace the placeholder page**

Overwrite `src/app/audience/sizes/page.tsx`:

```tsx
import { Header } from "@/components/layout/header";
import { prisma } from "@/lib/db";
import { getCachedSegments } from "@/lib/cache/segments";
import { safeEstimateForRule, mergeSegmentSizeRows } from "@/lib/segments/size-rows";
import { SegmentSizesTable } from "@/components/segments/segment-sizes-table";

export const dynamic = "force-dynamic";

export default async function SizesPage() {
  const [ruleSegs, htSegs] = await Promise.all([
    prisma.segment.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, description: true, rule: true, sizeExact: true, sizeComputedAt: true, updatedAt: true },
    }),
    getCachedSegments(),
  ]);

  const estimates = await Promise.all(ruleSegs.map((s) => safeEstimateForRule(s.rule)));
  const ruleInputs = ruleSegs.map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    estimate: estimates[i],
    sizeExact: s.sizeExact,
    sizeComputedAt: s.sizeComputedAt,
    updatedAt: s.updatedAt,
  }));

  const rows = mergeSegmentSizeRows(ruleInputs, htSegs);

  return (
    <>
      <Header
        title="Sizes"
        description="Estimated and exact sizes for every audience you've built or imported from Hightouch."
      />
      <div className="flex-1 p-6">
        <SegmentSizesTable rows={rows} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run check:quick`
Expected: typecheck + lint clean, all unit/contract tests pass.

- [ ] **Step 3: Full check before MR**

Run: `bun run check`
Expected: EXIT 0 — full integration + regression suite green (incl. the four new test files).

- [ ] **Step 4: Commit**

```bash
git add src/app/audience/sizes/page.tsx
git commit -m "feat(audience): wire up /audience/sizes overview page"
```

---

## Final verification (after all tasks)

- [ ] Dispatch a final holistic code review over the whole C2 diff (`git diff 0b5c5f3..HEAD`).
- [ ] Confirm the SQL-injection invariant is preserved end-to-end: the refresh endpoint only ever passes catalog-compiled `CompiledWhere` (user values bound as `$n`) into `exactSegmentSize`; no user string is interpolated into SQL.
- [ ] **Ship-time prod step (NOT part of code tasks):** apply `prisma/migrations/20260607170000_add_segment_size_cache/migration.sql` to prod via the unpooled connection, `prisma migrate resolve --applied 20260607170000_add_segment_size_cache`, verify `prisma migrate status` is clean. Then push branch → `glab mr create` → poll merge-request until mergeable → `glab mr merge`.

---

## Notes for the implementer

- **No `any`.** All new code is fully typed; `SizeRow` is a discriminated union — narrow on `row.kind` before accessing kind-specific fields.
- **Dates cross the server→client boundary as ISO strings** (`mergeSegmentSizeRows` already converts) — never pass raw `Date` objects into the client component.
- **Sequential, never parallel** for Refresh-all — each exact COUNT can run up to 15s on the ~34M-row `User` table; firing them in parallel would pile concurrent heavy scans onto Postgres.
- **Timeout is not an error.** `exactSegmentSize` returns `{ count: null, timedOut: true }`; the endpoint returns 200 with `timedOut: true` and leaves the prior cached value untouched.
- Run `bun run check:quick` while iterating; `bun run check` before opening the MR.
