# Neon Compute Cost Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the ~$400/mo Neon compute bill by skipping no-op segment re-materializations, consolidating the two hourly cron wakes into one, and lowering max CU 4 → 2.

**Architecture:** Add a drift-aware skip to `materializeAllSegments` driven by two additive pieces of state: a nullable `Segment.materializedAt` column stamped after each successful materialization, and an `AppSetting` row `last_user_ingest_at` bumped (throttled) by the user-ingest route. A pure predicate decides per segment whether anything could have changed since the last run. Config changes: `materialize-segments` cron moves :45 → :10, and one Neon API call lowers `autoscaling_limit_max_cu` to 2.

**Tech Stack:** Next.js App Router route handlers, Prisma v7 + PostgreSQL (Neon prod / local `nexus_test` for integration tests), bun test.

**Spec:** `docs/superpowers/specs/2026-06-10-neon-compute-cost-reduction-design.md`

---

## Critical context for implementers

- **Prod-DB safety:** `prisma.config.ts` loads `.env.local` = **production** Neon DB. `npx prisma migrate dev` therefore runs against prod — that is the normal workflow here, and this migration is **purely additive** (one nullable column). NEVER run `prisma migrate dev` / `db push` pointed at the test DB. The local test DB (`nexus_test`) gets its schema from `pg_dump`, so it needs a manual `ALTER TABLE` (Task 1).
- **`@updatedAt` trap:** `Segment.updatedAt` is Prisma `@updatedAt` (client-maintained). Stamping `materializedAt` through `prisma.segment.update` would bump `updatedAt` to "now" — which is *after* `runStart` — so the skip predicate (`updatedAt <= materializedAt`) would never pass and every run would re-scan. The stamp MUST use raw SQL (`$executeRaw`), which bypasses Prisma's client-side `@updatedAt`. Task 4 includes a regression test for this.
- **Test runners:** unit tests run with `bun run test:quick` (no DB). Integration tests run ONE file at a time: `TEST_FILES=tests/integration/<file> bun run test:int-reg` (requires local `nexus_test` Postgres). Full gate before MR: `bun run check`.
- **Git:** direct pushes to `main` are hook-blocked. Work on branch `feat/neon-compute-cost-reduction`, commit per task, MR at the end.
- **Untracked files** `docs/json/new_conversion_logic.md` and `docs/json/hightouch-interaction-flags.json` are unrelated — never stage them.

---

### Task 1: Additive schema — `Segment.materializedAt`

**Files:**
- Modify: `prisma/schema.prisma` (Segment model, ~line 540)
- Created by tooling: `prisma/migrations/<timestamp>_segment_materialized_at/migration.sql`

- [ ] **Step 1: Add the column to the Prisma model**

In `prisma/schema.prisma`, inside `model Segment` (after `sizeComputedAt DateTime?`):

```prisma
  materializedAt DateTime?
```

- [x] **Step 2: Apply the column to prod (additive only)**

> **Execution note (2026-06-10):** `prisma migrate dev --create-only` was aborted — the prod DB has migration drift (two applied migrations missing locally, plus a dropped FK) and Prisma demanded a full schema **reset**. Never accept that. The column was applied directly instead:

```bash
echo 'ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "materializedAt" TIMESTAMP(3);' | npx prisma db execute --stdin
```

Expected: `Script executed successfully.` Then:

```bash
npx prisma generate
```

- [ ] **Step 3: Mirror the column on the local test DB**

```bash
psql -d nexus_test -c 'ALTER TABLE "Segment" ADD COLUMN "materializedAt" TIMESTAMP(3);'
```

Expected: `ALTER TABLE`.

- [ ] **Step 4: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(segments): add Segment.materializedAt for drift-aware materialization skip"
```

---

### Task 2: Skip predicate (pure function)

**Files:**
- Create: `src/lib/segments/materialize-skip.ts`
- Test: `tests/unit/materialize-skip.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/materialize-skip.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { shouldSkipMaterialization, INGEST_MARGIN_MS } from "@/lib/segments/materialize-skip";

const T0 = new Date("2026-06-10T12:00:00.000Z"); // materializedAt baseline

describe("shouldSkipMaterialization", () => {
  it("never skips a never-materialized segment (materializedAt null)", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: null,
        updatedAt: new Date(T0.getTime() - 86_400_000),
        lastUserIngestAt: new Date(T0.getTime() - 86_400_000),
      }),
    ).toBe(false);
  });

  it("never skips when the rule was edited after the last materialization", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() + 1_000), // rule edited after run
        lastUserIngestAt: new Date(T0.getTime() - 3_600_000),
      }),
    ).toBe(false);
  });

  it("never skips when user ingest happened after the last materialization", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() + 1_000),
      }),
    ).toBe(false);
  });

  it("never skips when ingest is inside the safety margin (throttled marker may hide writes)", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() - INGEST_MARGIN_MS + 1), // 1ms inside margin
      }),
    ).toBe(false);
  });

  it("skips when ingest marker is exactly at the margin boundary", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() - INGEST_MARGIN_MS),
      }),
    ).toBe(true);
  });

  it("skips when both rule and ingest are safely older than the last materialization", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() - 4 * 3_600_000),
      }),
    ).toBe(true);
  });

  it("allows updatedAt exactly equal to materializedAt (unchanged rule) to skip", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: T0,
        lastUserIngestAt: new Date(T0.getTime() - 4 * 3_600_000),
      }),
    ).toBe(true);
  });

  it("exports the 2-minute margin (twice the marker throttle)", () => {
    expect(INGEST_MARGIN_MS).toBe(120_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test tests/unit/materialize-skip.test.ts
```

Expected: FAIL — cannot resolve `@/lib/segments/materialize-skip`.

- [ ] **Step 3: Implement the predicate**

Create `src/lib/segments/materialize-skip.ts`:

```typescript
/** Margin below the stored ingest marker that must separate it from the last
 *  materialization before we trust "no user drift". The marker write is
 *  throttled to once per 60s, so up to 60s of User writes can land *after*
 *  the stored marker value; requiring the marker to be at least 2× that
 *  (120s) older than materializedAt guarantees those hidden writes force a
 *  re-scan instead of being skipped until the next sync. */
export const INGEST_MARGIN_MS = 120_000;

/** A segment's re-materialization is a no-op when (a) it has been
 *  materialized before, (b) its rule hasn't been edited since, and (c) no
 *  user ingest has happened since (with the throttle margin above). */
export function shouldSkipMaterialization(args: {
  materializedAt: Date | null;
  updatedAt: Date;
  lastUserIngestAt: Date;
}): boolean {
  const { materializedAt, updatedAt, lastUserIngestAt } = args;
  if (materializedAt === null) return false;
  if (updatedAt.getTime() > materializedAt.getTime()) return false;
  return lastUserIngestAt.getTime() <= materializedAt.getTime() - INGEST_MARGIN_MS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test tests/unit/materialize-skip.test.ts
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/materialize-skip.ts tests/unit/materialize-skip.test.ts
git commit -m "feat(segments): pure skip predicate for drift-aware materialization"
```

---

### Task 3: Ingest marker module (read + throttled bump)

**Files:**
- Create: `src/lib/segments/ingest-marker.ts`
- Test: `tests/integration/ingest-marker.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/ingest-marker.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  USER_INGEST_MARKER_KEY,
  MARKER_THROTTLE_MS,
  bumpUserIngestMarker,
  readUserIngestMarker,
} from "@/lib/segments/ingest-marker";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("bumpUserIngestMarker", () => {
  it("creates the AppSetting row when absent", async () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(now);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(now.toISOString());
  });

  it("skips the write when the stored value is younger than the throttle", async () => {
    const t0 = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(t0);

    const t1 = new Date(t0.getTime() + MARKER_THROTTLE_MS - 1_000); // 59s later
    await bumpUserIngestMarker(t1);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(t0.toISOString()); // unchanged
  });

  it("writes when the stored value is older than the throttle", async () => {
    const t0 = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(t0);

    const t1 = new Date(t0.getTime() + MARKER_THROTTLE_MS + 1_000); // 61s later
    await bumpUserIngestMarker(t1);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(t1.toISOString());
  });

  it("overwrites an unparseable stored value", async () => {
    await prisma.appSetting.create({ data: { key: USER_INGEST_MARKER_KEY, value: "not-a-date" } });
    const now = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(now);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(now.toISOString());
  });
});

describe("readUserIngestMarker", () => {
  it("returns the stored timestamp when present and valid", async () => {
    const t0 = new Date("2026-06-10T08:00:00.000Z");
    await prisma.appSetting.create({ data: { key: USER_INGEST_MARKER_KEY, value: t0.toISOString() } });

    const result = await readUserIngestMarker(new Date("2026-06-10T12:00:00.000Z"));
    expect(result.toISOString()).toBe(t0.toISOString());
  });

  it("fails open to `now` when the row is missing", async () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    const result = await readUserIngestMarker(now);
    expect(result.toISOString()).toBe(now.toISOString());
  });

  it("fails open to `now` when the stored value is unparseable", async () => {
    await prisma.appSetting.create({ data: { key: USER_INGEST_MARKER_KEY, value: "garbage" } });
    const now = new Date("2026-06-10T12:00:00.000Z");
    const result = await readUserIngestMarker(now);
    expect(result.toISOString()).toBe(now.toISOString());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
TEST_FILES=tests/integration/ingest-marker.test.ts bun run test:int-reg
```

Expected: FAIL — cannot resolve `@/lib/segments/ingest-marker`.

- [ ] **Step 3: Implement the module**

Create `src/lib/segments/ingest-marker.ts`:

```typescript
import { prisma } from "@/lib/db";

export const USER_INGEST_MARKER_KEY = "last_user_ingest_at";
/** High-frequency ingest must not hammer one AppSetting row — at most one
 *  marker write per minute. The skip predicate compensates with a 2× margin
 *  (see INGEST_MARGIN_MS in materialize-skip.ts). */
export const MARKER_THROTTLE_MS = 60_000;

/** Record "User-table data changed around `now`". Throttled: a no-op when the
 *  stored marker is younger than MARKER_THROTTLE_MS. */
export async function bumpUserIngestMarker(now: Date = new Date()): Promise<void> {
  const existing = await prisma.appSetting.findUnique({
    where: { key: USER_INGEST_MARKER_KEY },
    select: { value: true },
  });
  if (existing) {
    const prev = Date.parse(existing.value);
    if (!Number.isNaN(prev) && now.getTime() - prev < MARKER_THROTTLE_MS) return;
  }
  await prisma.appSetting.upsert({
    where: { key: USER_INGEST_MARKER_KEY },
    create: { key: USER_INGEST_MARKER_KEY, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
}

/** Last time user ingest touched the User table. Fail-open: a missing or
 *  unparseable marker reads as `now`, which makes the skip predicate
 *  materialize everything (today's behavior) — a failure must never skip
 *  toward staleness. */
export async function readUserIngestMarker(now: Date = new Date()): Promise<Date> {
  const row = await prisma.appSetting.findUnique({
    where: { key: USER_INGEST_MARKER_KEY },
    select: { value: true },
  });
  if (!row) return now;
  const parsed = Date.parse(row.value);
  if (Number.isNaN(parsed)) return now;
  return new Date(parsed);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
TEST_FILES=tests/integration/ingest-marker.test.ts bun run test:int-reg
```

Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/ingest-marker.ts tests/integration/ingest-marker.test.ts
git commit -m "feat(segments): last_user_ingest_at marker with 60s write throttle"
```

---

### Task 4: Wire the skip into `materializeAllSegments`

**Files:**
- Modify: `src/lib/segments/materialize.ts`
- Test: `tests/integration/materialize-skip-fresh.test.ts` (new)
- Existing tests must stay green: `tests/integration/materialize-all-segments.test.ts`

**Behavior to implement:**
1. `MaterializeSummary` gains `segmentsSkippedFresh: number`; `perSegment` entries gain optional `skipped?: "fresh"`.
2. Read the ingest marker **once per run** (only when there are referenced segments).
3. Select `updatedAt` + `materializedAt` alongside `name`/`rule`.
4. Evaluate `shouldSkipMaterialization` per segment **before** parsing/compiling; on skip, count it and continue (no transaction, no sweep).
5. After a successful materialization, stamp `materializedAt = runStart` **via raw SQL** so Prisma's `@updatedAt` does not bump `updatedAt` (see Critical context).

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/materialize-skip-fresh.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { USER_INGEST_MARKER_KEY } from "@/lib/segments/ingest-marker";
import { createUser, createAgent } from "../helpers/builders";

const WAU_RULE = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }],
};

async function createSegment(name: string, rule: unknown) {
  return prisma.segment.create({ data: { name, rule: rule as Prisma.InputJsonValue } });
}

async function setIngestMarker(at: Date) {
  await prisma.appSetting.upsert({
    where: { key: USER_INGEST_MARKER_KEY },
    create: { key: USER_INGEST_MARKER_KEY, value: at.toISOString() },
    update: { value: at.toISOString() },
  });
}

// IMPORTANT: all timestamps are relative to `new Date()` captured AFTER fixture
// creation. Fixed wall-clock timestamps would race against the real
// Segment.updatedAt (@updatedAt) values Prisma writes at test time.

describe("drift-aware materialization skip", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
    await prisma.appSetting.deleteMany();
  });

  it("skips a fresh segment and reports segmentsSkippedFresh", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date(); // after fixtures, so segment.updatedAt <= run1
    await setIngestMarker(new Date(run1.getTime() - 3_600_000)); // ingest 1h before run1
    const first = await materializeAllSegments({ runStart: run1 });
    expect(first.segmentsProcessed).toBe(1);
    expect(first.segmentsSkippedFresh).toBe(0);

    const run2 = new Date(run1.getTime() + 3_600_000); // next hourly run, no drift
    const second = await materializeAllSegments({ runStart: run2 });

    expect(second.segmentsProcessed).toBe(0);
    expect(second.segmentsSkippedFresh).toBe(1);
    expect(second.perSegment).toEqual([
      { name: "wau-seg", matched: 0, deleted: 0, skipped: "fresh" },
    ]);
  });

  it("a skipped run leaves UserSegment rows untouched (no sweep)", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });
    const before = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg" },
      orderBy: { externalId: "asc" },
    });

    await materializeAllSegments({ runStart: new Date(run1.getTime() + 3_600_000) });
    const after = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg" },
      orderBy: { externalId: "asc" },
    });

    expect(after).toEqual(before); // byte-identical incl. syncedAt
  });

  it("a newer ingest marker forces a re-scan", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });

    // Hightouch sync lands between runs; a new user now matches.
    await createUser("wau-2", { funnelStage: "wau" });
    const run2 = new Date(run1.getTime() + 3_600_000);
    await setIngestMarker(new Date(run2.getTime() - 60_000));
    const second = await materializeAllSegments({ runStart: run2 });

    expect(second.segmentsProcessed).toBe(1);
    expect(second.segmentsSkippedFresh).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg" } });
    expect(rows.map((r) => r.externalId).sort()).toEqual(["wau-1", "wau-2"]);
  });

  it("a rule edit forces re-materialization even with no ingest", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createUser("mau-1", { funnelStage: "mau" });
    await createSegment("seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });

    // Edit the rule. @updatedAt bumps Segment.updatedAt to real-now, which is
    // after run1 (= materializedAt), so the skip must not fire — even though
    // run2's marker is still safely old.
    await prisma.segment.update({
      where: { name: "seg" },
      data: {
        rule: {
          kind: "group",
          join: "AND",
          children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["mau"] }],
        } as Prisma.InputJsonValue,
      },
    });

    const second = await materializeAllSegments({ runStart: new Date(run1.getTime() + 3_600_000) });

    expect(second.segmentsProcessed).toBe(1);
    expect(second.segmentsSkippedFresh).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "seg", source: "rule" } });
    expect(rows.map((r) => r.externalId)).toEqual(["mau-1"]);
  });

  it("a missing ingest marker fails open: everything re-materializes", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const run1 = new Date();
    await setIngestMarker(new Date(run1.getTime() - 3_600_000));
    await materializeAllSegments({ runStart: run1 });

    await prisma.appSetting.deleteMany({ where: { key: USER_INGEST_MARKER_KEY } });
    const second = await materializeAllSegments({ runStart: new Date(run1.getTime() + 3_600_000) });

    expect(second.segmentsProcessed).toBe(1);
    expect(second.segmentsSkippedFresh).toBe(0);
  });

  it("REGRESSION: stamping materializedAt does not bump Segment.updatedAt", async () => {
    // If the stamp goes through prisma.segment.update, @updatedAt silently
    // bumps updatedAt past materializedAt and the skip never fires again.
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const before = await prisma.segment.findUniqueOrThrow({ where: { name: "wau-seg" } });
    const runStart = new Date(before.updatedAt.getTime() + 60_000);
    await setIngestMarker(new Date(runStart.getTime() - 3_600_000));
    await materializeAllSegments({ runStart });

    const after = await prisma.segment.findUniqueOrThrow({ where: { name: "wau-seg" } });
    expect(after.materializedAt?.toISOString()).toBe(runStart.toISOString());
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
TEST_FILES=tests/integration/materialize-skip-fresh.test.ts bun run test:int-reg
```

Expected: FAIL — `segmentsSkippedFresh` is `undefined`, segments re-process every run.

- [ ] **Step 3: Implement in `src/lib/segments/materialize.ts`**

Add imports at the top:

```typescript
import { readUserIngestMarker } from "./ingest-marker";
import { shouldSkipMaterialization } from "./materialize-skip";
```

Change `MaterializeSummary` to:

```typescript
export type MaterializeSummary = {
  runStart: string;
  segmentsProcessed: number;
  segmentsSkipped: number; // null/unparseable rule, or a rule that matches everyone
  segmentsSkippedFresh: number; // nothing changed since the last materialization
  segmentsFailed: number; // threw during reconcile (timeout, SQL error)
  perSegment: { name: string; matched: number; deleted: number; error?: string; skipped?: "fresh" }[];
};
```

In `materializeAllSegments`, initialize `segmentsSkippedFresh: 0` in the summary literal, then replace the segment query + loop body:

```typescript
  if (names.size === 0) return summary;

  // Read once per run, not per segment. Fail-open: missing marker reads as
  // `runStart`, which disables skipping for this run.
  const lastUserIngestAt = await readUserIngestMarker(runStart);

  const segments = await prisma.segment.findMany({
    where: { name: { in: [...names] } },
    select: { name: true, rule: true, updatedAt: true, materializedAt: true },
  });

  for (const segment of segments) {
    if (
      shouldSkipMaterialization({
        materializedAt: segment.materializedAt,
        updatedAt: segment.updatedAt,
        lastUserIngestAt,
      })
    ) {
      summary.segmentsSkippedFresh += 1;
      summary.perSegment.push({ name: segment.name, matched: 0, deleted: 0, skipped: "fresh" });
      continue;
    }
    const rule = parseSegmentRule(segment.rule);
    if (rule === null) {
      summary.segmentsSkipped += 1;
      summary.perSegment.push({ name: segment.name, matched: 0, deleted: 0, error: "unparseable rule" });
      continue;
    }
    const where = compileSegmentRule(rule);
    // An empty rule compiles to "TRUE" (match every user) — refuse to materialize it.
    if (where.sql === "TRUE") {
      summary.segmentsSkipped += 1;
      summary.perSegment.push({ name: segment.name, matched: 0, deleted: 0, error: "empty rule matches all users" });
      continue;
    }
    try {
      // The default interactive-transaction timeout is 5s, which fires before the
      // 60s statement_timeout set inside materializeSegment. Raise the wrapper's
      // budget above SEGMENT_TIMEOUT_MS so large segments aren't aborted early.
      const { matched, deleted } = await prisma.$transaction(
        (tx) => materializeSegment(tx, { segmentName: segment.name, where, runStart }),
        { timeout: MATERIALIZE_TX_TIMEOUT_MS },
      );
      // Raw SQL on purpose: prisma.segment.update would bump @updatedAt past
      // runStart and the skip predicate would never pass again.
      await prisma.$executeRaw`UPDATE "Segment" SET "materializedAt" = ${runStart} WHERE "name" = ${segment.name}`;
      summary.segmentsProcessed += 1;
      summary.perSegment.push({ name: segment.name, matched, deleted });
    } catch (err) {
      summary.segmentsFailed += 1;
      summary.perSegment.push({
        name: segment.name,
        matched: 0,
        deleted: 0,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }
```

- [ ] **Step 4: Run the new tests, then the pre-existing materialize suites**

```bash
TEST_FILES=tests/integration/materialize-skip-fresh.test.ts bun run test:int-reg
```

Expected: 6 pass, 0 fail.

```bash
TEST_FILES=tests/integration/materialize-all-segments.test.ts bun run test:int-reg
```

Expected: all pass. Note: these older tests don't set an ingest marker, so the fail-open path (marker missing → `lastUserIngestAt = runStart`) keeps them re-materializing every call — they must pass unchanged. Also run:

```bash
TEST_FILES=tests/integration/cron-materialize-segments-route.test.ts bun run test:int-reg
TEST_FILES=tests/integration/flag-rule-segment-materialize.test.ts bun run test:int-reg
TEST_FILES=tests/integration/materialize-segment.test.ts bun run test:int-reg
```

Expected: all pass.

- [ ] **Step 5: Typecheck (the summary type changed — check for consumers)**

```bash
bun run typecheck
```

Expected: exit 0. If any consumer of `MaterializeSummary` fails to compile (e.g., a cron-runs UI or route asserting the shape), the new fields are additive — fix the consumer by handling/ignoring `segmentsSkippedFresh`, never by removing it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/segments/materialize.ts tests/integration/materialize-skip-fresh.test.ts
git commit -m "feat(segments): drift-aware skip in materializeAllSegments with segmentsSkippedFresh"
```

---

### Task 5: Bump the marker from `POST /api/ingest/users`

**Files:**
- Modify: `src/app/api/ingest/users/route.ts` (after the chunked upsert loop, ~line 1339, just before `responseBody` is built)
- Test: extend `tests/integration/ingest-users.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to the end of `tests/integration/ingest-users.test.ts` (it already imports `POST`, `buildRequest`, `prisma`, and defines `AUTH`):

```typescript
describe("user-ingest marker", () => {
  it("bumps last_user_ingest_at after upserting users", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_marker", attributes: {} }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const row = await prisma.appSetting.findUnique({ where: { key: "last_user_ingest_at" } });
    expect(row).toBeTruthy();
    expect(Number.isNaN(Date.parse(row!.value))).toBe(false);
  });

  it("does not create the marker when nothing was upserted", async () => {
    const req = buildRequest("POST", { users: [] }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const row = await prisma.appSetting.findUnique({ where: { key: "last_user_ingest_at" } });
    expect(row).toBeNull();
  });
});
```

Note: if `buildRequest("POST", { users: [] }, AUTH)` returns a non-200 in this route (check the validation behavior at the top of the handler when running the test), substitute a payload that passes validation but upserts nothing — e.g. an anonymous-only batch that the route skips. The assertion that matters is: **no upserts → no marker row**.

- [ ] **Step 2: Run the test to verify it fails**

```bash
TEST_FILES=tests/integration/ingest-users.test.ts bun run test:int-reg
```

Expected: the new "bumps last_user_ingest_at" test FAILS (row is null); all pre-existing tests still pass.

- [ ] **Step 3: Implement the bump**

In `src/app/api/ingest/users/route.ts`, add the import:

```typescript
import { bumpUserIngestMarker } from "@/lib/segments/ingest-marker";
```

After the chunk loop finishes (after the `for (const r of results) { ... }` accumulation block and its enclosing chunk loop, immediately before `const responseBody = {`):

```typescript
  if (upserted > 0) {
    // Drift marker for materialize-segments' skip predicate. Non-fatal: a
    // failed bump only risks one extra full scan window, never data loss.
    await bumpUserIngestMarker().catch((err) => {
      console.error("[ingest/users] Failed to bump last_user_ingest_at:", err);
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
TEST_FILES=tests/integration/ingest-users.test.ts bun run test:int-reg
```

Expected: all pass (including both new tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ingest/users/route.ts tests/integration/ingest-users.test.ts
git commit -m "feat(ingest): bump last_user_ingest_at marker after user upserts"
```

---

### Task 6: Move `materialize-segments` cron :45 → :10

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Edit the schedule**

In `vercel.json`, change the `materialize-segments` cron entry:

```json
{ "path": "/api/cron/materialize-segments", "schedule": "10 * * * *" }
```

(was `"45 * * * *"`; leave every other cron untouched).

- [ ] **Step 2: Sanity-check the file**

```bash
bun -e 'const c = require("./vercel.json"); console.log(JSON.stringify(c.crons, null, 2))'
```

Expected: valid JSON; `materialize-segments` at `10 * * * *`; `select-and-send` still `0 * * * *`.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "perf(cron): run materialize-segments at :10 so both hourly crons share one wake window"
```

---

### Task 7: Full gate + ship the MR

- [ ] **Step 1: Run the full check (background, capture exit code)**

```bash
bun run check > /tmp/neon-check.log 2>&1; echo "EXIT:$?" >> /tmp/neon-check.log
```

Then inspect `/tmp/neon-check.log` — expected final line `EXIT:0`. If failures: fix, re-run, never skip.

- [ ] **Step 2: Push the branch and open the MR**

Direct pushes to `main` are hook-blocked. From branch `feat/neon-compute-cost-reduction`:

```bash
git push -u origin feat/neon-compute-cost-reduction
glab mr create --title "perf(segments): drift-aware materialization skip + single hourly cron wake" --description "Implements docs/superpowers/specs/2026-06-10-neon-compute-cost-reduction-design.md (changes 1 and 2). Adds Segment.materializedAt + last_user_ingest_at AppSetting marker; skips no-op re-materializations; moves materialize-segments cron :45 → :10. Change 3 (Neon max CU 4→2) is a separate API call executed with explicit go-ahead." --remove-source-branch
```

Note: `glab` 401s can be transient — retry the identical command once before debugging auth.

- [ ] **Step 3: Merge**

```bash
glab mr merge <NUMBER> --remove-source-branch
```

---

### Task 8: Lower Neon max CU 4 → 2 (MANUAL — requires Dan's explicit go-ahead)

**Do NOT execute this task autonomously.** Stop and ask Dan for go-ahead first. Execute only after Tasks 1–7 are merged and deployed.

- [ ] **Step 1: Get explicit confirmation from Dan**

Ask: "Tasks 1–7 are merged and deployed. Ready to lower Neon max CU from 4 to 2 now?" Proceed only on a yes.

- [ ] **Step 2: Execute the PATCH (never print the key)**

```bash
NEON_API_KEY=$(grep '^NEON_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')
curl -s -X PATCH \
  "https://console.neon.tech/api/v2/projects/solitary-cherry-26476014/endpoints/ep-old-surf-a4p5os6s" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": {"autoscaling_limit_max_cu": 2}}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); e=d.get("endpoint",{}); print({"max_cu": e.get("autoscaling_limit_max_cu"), "min_cu": e.get("autoscaling_limit_min_cu"), "suspend": e.get("suspend_timeout_seconds")})'
```

Expected: `{'max_cu': 2, 'min_cu': 0.25, 'suspend': 300}`.

- [ ] **Step 3: Note the revert path**

Revert = same call with `"autoscaling_limit_max_cu": 4`. If `/api/cron/runs` shows materialization failures or `select-and-send` duration spikes after the change, revert first, investigate second.

---

## Post-ship verification (1 week, no code)

- Neon dashboard: compute hours and average CU materially down (target ≥ 50% bill reduction).
- `/api/cron/runs`: no `materialize-segments` failures; runs after quiet hours show `segmentsSkippedFresh > 0`.
- Membership still reflects rule edits within one cron cycle and Hightouch syncs within one cycle of ingest.
