# C3 — Segment Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled cron job materializes each agent-referenced rule-`Segment`'s membership into the `UserSegment` table (tagged `source='rule'`) so the existing `select-and-send` set-intersection path targets rule-segments with zero changes.

**Architecture:** Add a `source` discriminator to `UserSegment` and widen its unique constraint to `(externalId, segmentName, source)`. A new cron route (`/api/cron/materialize-segments`) collects segment names referenced by any agent, compiles each saved `Segment.rule` to a parameterized WHERE via the existing `compileSegmentRule`, and runs a per-segment "upsert-then-watermark-sweep" reconcile in a transaction. Hightouch ingest keeps writing `source='hightouch'`; the rule job only ever touches `source='rule'` rows, so the two sources coexist under one segment name.

**Tech Stack:** Next.js 16 App Router route handlers, Prisma v7 + PostgreSQL (Neon), `$executeRawUnsafe` for the set-based reconcile, Bun test runner.

---

## Spec

Full design: `docs/superpowers/specs/2026-06-07-segments-sizes-c3-design.md`. Read it for background; this plan is self-contained.

## Standing constraints (carry through every task)

- **Never run `prisma migrate dev` / `db push` against any DB** — `prisma.config.ts` loads `.env.local` = PROD. Schema changes ship via idempotent DDL + a hand-written migration folder + `prisma migrate resolve --applied`.
- **Local test DB commands MUST be prefixed** to avoid prod PG\* env bleed:
  ```
  env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT \
    PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 \
    DATABASE_URL="postgresql://localhost:5432/nexus_test"
  ```
- **Never run tests in the background.** Iterate with `bun run check:quick`; run `bun run check` before opening the MR.
- **Direct-to-main is blocked.** Ship via: commit → branch → push → `glab mr create` → poll until `detailed_merge_status=mergeable` → `glab mr merge`. Use `glab`, NOT `gh`.
- **No `any`.** Routes return `{ data: T }` / `{ error: string }` with correct HTTP status. JSON DB fields parsed/validated on read.

## File Structure

**Create:**
- `prisma/migrations/20260607180000_add_usersegment_source/migration.sql` — idempotent DDL: add `source`, swap the unique index.
- `src/lib/segments/materialize.ts` — `collectReferencedSegmentNames`, `materializeSegment`, `materializeAllSegments`, `MaterializeSummary`. The whole materialization brain; route stays thin.
- `src/app/api/cron/materialize-segments/route.ts` — thin cron handler: auth → `materializeAllSegments` → write `CronRun` → `{ data: summary }`.
- `tests/unit/collect-referenced-segment-names.test.ts`
- `tests/integration/materialize-segment.test.ts`
- `tests/integration/materialize-all-segments.test.ts`
- `tests/integration/cron-materialize-segments-route.test.ts`
- `tests/regression/materialize-segments-sql-columns.test.ts`
- `tests/regression/ingest-segments-source-key.test.ts`
- `tests/integration/select-and-send-consumes-rule-segments.test.ts`

**Modify:**
- `prisma/schema.prisma` — `UserSegment`: add `source String @default("hightouch")`, widen `@@unique`.
- `src/app/api/ingest/segments/route.ts` — upsert compound key `externalId_segmentName` → `externalId_segmentName_source`, set `source: "hightouch"`.
- `tests/helpers/builders.ts` — `createUserSegment` gains an optional `source` arg.
- `vercel.json` — add the `materialize-segments` cron entry.

---

## Task 1: Schema change + migration + ripple updates

Widen `UserSegment` with a `source` discriminator. This is the foundation every later task builds on. It also touches the existing Hightouch ingest upsert (its compound-key name changes) and the test builder.

**Files:**
- Modify: `prisma/schema.prisma:486-494` (UserSegment model)
- Create: `prisma/migrations/20260607180000_add_usersegment_source/migration.sql`
- Modify: `src/app/api/ingest/segments/route.ts:88-92`
- Modify: `tests/helpers/builders.ts:259-263`
- Create: `tests/regression/ingest-segments-source-key.test.ts`

- [ ] **Step 1: Edit the Prisma schema**

In `prisma/schema.prisma`, replace the `UserSegment` model (currently lines 486-494) with:

```prisma
// HT audience segment membership (source='hightouch', append-only via POST /api/ingest/segments)
// plus rule-segment membership (source='rule', full-replace via /api/cron/materialize-segments).
model UserSegment {
  id          String   @id @default(cuid())
  externalId  String   // TrackedUser.externalId (no FK — same pattern as UserDecision)
  segmentName String
  source      String   @default("hightouch") // "hightouch" | "rule"
  syncedAt    DateTime @default(now()) @updatedAt

  @@unique([externalId, segmentName, source])
  @@index([segmentName])  // cron segment filter (queries by name alone, unions both sources)
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260607180000_add_usersegment_source/migration.sql`:

```sql
-- Add a source discriminator so rule-materialized membership (source='rule')
-- coexists with Hightouch-synced membership (source='hightouch') under the same
-- segmentName. The rule job's stale-member sweep filters on source='rule', so it
-- never deletes Hightouch-owned rows. Idempotent: safe to re-run.
ALTER TABLE "UserSegment" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'hightouch';

-- Swap the old 2-column unique for the 3-column unique. Prisma's default index
-- name for the old constraint is "UserSegment_externalId_segmentName_key"
-- (confirmed in local test DB; matches prod Prisma naming).
DROP INDEX IF EXISTS "UserSegment_externalId_segmentName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "UserSegment_externalId_segmentName_source_key"
  ON "UserSegment" ("externalId", "segmentName", "source");
```

- [ ] **Step 3: Apply the DDL to the local test DB and regenerate the client**

```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT \
  PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 \
  psql -d nexus_test -v ON_ERROR_STOP=1 \
  -f prisma/migrations/20260607180000_add_usersegment_source/migration.sql

npx prisma generate
```

Expected: `psql` prints `ALTER TABLE`, `DROP INDEX`, `CREATE INDEX` (or notices that the column/index already exist on re-run). `prisma generate` succeeds.

> NOTE: `prisma generate` may also touch `apps/api/src/generated/prisma/*` barrel files unrelated to this change. If `git status` shows dirty `apps/api/src/generated/prisma/` files that aren't the `UserSegment` model, run `git checkout -- apps/api/src/generated/prisma/` to keep the branch scoped. Do NOT commit those.

- [ ] **Step 4: Update the test builder**

In `tests/helpers/builders.ts`, replace `createUserSegment` (lines 259-263):

```ts
export async function createUserSegment(
  externalId: string,
  segmentName: string,
  source: string = "hightouch",
) {
  return prisma.userSegment.create({
    data: { externalId, segmentName, source },
  });
}
```

- [ ] **Step 5: Update the Hightouch ingest upsert key**

In `src/app/api/ingest/segments/route.ts`, replace the `userSegment.upsert` block (lines 88-92):

```ts
          await prisma.userSegment.upsert({
            where: { externalId_segmentName_source: { externalId, segmentName, source: "hightouch" } },
            create: { externalId, segmentName, source: "hightouch", syncedAt: now },
            update: { syncedAt: now },
          });
```

- [ ] **Step 6: Write the ingest regression test**

Create `tests/regression/ingest-segments-source-key.test.ts`:

```ts
// Regression: widening UserSegment's unique constraint to include `source`
// (C3 spec, 2026-06-07) changed the Hightouch ingest upsert's compound key from
// `externalId_segmentName` to `externalId_segmentName_source`. This guards that
// the ingest path still upserts correctly and stamps source='hightouch'.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/ingest/segments/route";
import { NextRequest } from "next/server";

function ingestRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ingest/segments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.HIGHTOUCH_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ingest/segments source key", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
  });

  it("upserts membership tagged source='hightouch'", async () => {
    const res = await POST(
      ingestRequest({
        users: [{ external_user_id: "u-ht-1", attributes: { ht_segment_name: "vip" } }],
      }),
    );
    expect(res.status).toBe(200);

    const rows = await prisma.userSegment.findMany({ where: { externalId: "u-ht-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.segmentName).toBe("vip");
    expect(rows[0]?.source).toBe("hightouch");
  });

  it("is idempotent on re-sync (no duplicate row)", async () => {
    await POST(ingestRequest({ users: [{ external_user_id: "u-ht-1", attributes: { ht_segment_name: "vip" } }] }));
    await POST(ingestRequest({ users: [{ external_user_id: "u-ht-1", attributes: { ht_segment_name: "vip" } }] }));

    const rows = await prisma.userSegment.findMany({ where: { externalId: "u-ht-1", segmentName: "vip" } });
    expect(rows).toHaveLength(1);
  });
});
```

> The test reads `process.env.HIGHTOUCH_API_KEY`; the integration test env provides it (same pattern as existing ingest tests). If `verifyIngestAuth` needs a specific header, mirror an existing `tests/integration/ingest-*.test.ts` for the exact header shape before finalizing.

- [ ] **Step 7: Run the regression + existing ingest tests**

Run: `bun run test:int -- ingest-segments-source-key segments`
Expected: PASS for the new regression test; existing segment-ingest integration tests still green (constraint change didn't break them).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260607180000_add_usersegment_source \
  src/app/api/ingest/segments/route.ts tests/helpers/builders.ts \
  tests/regression/ingest-segments-source-key.test.ts
git commit -m "feat(segments): add UserSegment.source discriminator + widen unique key"
```

---

## Task 2: `collectReferencedSegmentNames`

Pure function: given the agents' targeting fields, return the deduped set of segment names any agent references (includes + excludes + legacy `targetSegmentName`).

**Files:**
- Create: `src/lib/segments/materialize.ts`
- Test: `tests/unit/collect-referenced-segment-names.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/collect-referenced-segment-names.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { collectReferencedSegmentNames } from "@/lib/segments/materialize";

describe("collectReferencedSegmentNames", () => {
  it("collects includes, excludes, and legacy targetSegmentName, deduped", () => {
    const names = collectReferencedSegmentNames([
      { segmentTargeting: { includes: ["a", "b"], excludes: ["c"] }, targetSegmentName: null },
      { segmentTargeting: { includes: ["b"], excludes: [] }, targetSegmentName: "d" },
      { segmentTargeting: null, targetSegmentName: "a" },
    ]);
    expect([...names].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty set when no agent targets a segment", () => {
    const names = collectReferencedSegmentNames([
      { segmentTargeting: null, targetSegmentName: null },
    ]);
    expect(names.size).toBe(0);
  });

  it("tolerates corrupt segmentTargeting JSON (degrades to skip)", () => {
    const names = collectReferencedSegmentNames([
      { segmentTargeting: "not-an-object", targetSegmentName: null },
      { segmentTargeting: { includes: "oops", excludes: 42 }, targetSegmentName: "real" },
    ]);
    expect([...names]).toEqual(["real"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:quick -- collect-referenced-segment-names`
Expected: FAIL — `collectReferencedSegmentNames` is not exported from `@/lib/segments/materialize` (module doesn't exist yet).

- [ ] **Step 3: Implement the function**

Create `src/lib/segments/materialize.ts`:

```ts
import { parseSegmentTargeting } from "@/lib/agent-targeting";

type AgentTargetingFields = {
  segmentTargeting: unknown;
  targetSegmentName: string | null;
};

/** Deduped set of every segment name referenced by any agent (includes, excludes,
 *  and the legacy single-include `targetSegmentName`). Corrupt targeting JSON
 *  degrades to "no names" via the tolerant parser. */
export function collectReferencedSegmentNames(agents: AgentTargetingFields[]): Set<string> {
  const names = new Set<string>();
  for (const agent of agents) {
    const targeting = parseSegmentTargeting(agent.segmentTargeting);
    if (targeting) {
      for (const n of targeting.includes) names.add(n);
      for (const n of targeting.excludes) names.add(n);
    }
    if (agent.targetSegmentName) names.add(agent.targetSegmentName);
  }
  return names;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:quick -- collect-referenced-segment-names`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/materialize.ts tests/unit/collect-referenced-segment-names.test.ts
git commit -m "feat(segments): collectReferencedSegmentNames helper"
```

---

## Task 3: `materializeSegment` (the reconcile)

The set-based reconcile for one segment: upsert all current matches stamping `syncedAt = runStart`, then sweep `source='rule'` rows whose `syncedAt < runStart`. Runs against a transaction client.

**Files:**
- Modify: `src/lib/segments/materialize.ts`
- Test: `tests/integration/materialize-segment.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/materialize-segment.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { materializeSegment } from "@/lib/segments/materialize";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { createUser, createUserSegment } from "../helpers/builders";
import type { SegmentRule } from "@/types/segment";

// funnelStage = 'wau' → "(u."funnelStage" = $1)" with params ["wau"]
const WAU_RULE: SegmentRule = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "eq", value: "wau" }],
};

describe("materializeSegment", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
  });

  it("inserts exactly the matching users as source='rule'", async () => {
    await createUser("match-1", { funnelStage: "wau" });
    await createUser("match-2", { funnelStage: "wau" });
    await createUser("no-match", { funnelStage: "mau" });

    const where = compileSegmentRule(WAU_RULE);
    const runStart = new Date();
    const result = await prisma.$transaction((tx) =>
      materializeSegment(tx, { segmentName: "wau-seg", where, runStart }),
    );

    expect(result.matched).toBe(2);
    const rows = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg", source: "rule" },
      orderBy: { externalId: "asc" },
    });
    expect(rows.map((r) => r.externalId)).toEqual(["match-1", "match-2"]);
  });

  it("sweeps stale rule-members who no longer match", async () => {
    await createUser("still-matches", { funnelStage: "wau" });
    // Pre-seed a stale rule-member with an old syncedAt who is NOT in the new match set.
    await prisma.userSegment.create({
      data: {
        externalId: "gone",
        segmentName: "wau-seg",
        source: "rule",
        syncedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });

    const where = compileSegmentRule(WAU_RULE);
    const runStart = new Date();
    const result = await prisma.$transaction((tx) =>
      materializeSegment(tx, { segmentName: "wau-seg", where, runStart }),
    );

    expect(result.deleted).toBe(1);
    const remaining = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "rule" } });
    expect(remaining.map((r) => r.externalId)).toEqual(["still-matches"]);
  });

  it("never touches source='hightouch' rows for the same segmentName", async () => {
    await createUser("rule-match", { funnelStage: "wau" });
    await createUserSegment("ht-only", "wau-seg", "hightouch");

    const where = compileSegmentRule(WAU_RULE);
    await prisma.$transaction((tx) =>
      materializeSegment(tx, { segmentName: "wau-seg", where, runStart: new Date() }),
    );

    const ht = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "hightouch" } });
    expect(ht.map((r) => r.externalId)).toEqual(["ht-only"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:int -- materialize-segment`
Expected: FAIL — `materializeSegment` is not exported yet.

- [ ] **Step 3: Implement `materializeSegment`**

Append to `src/lib/segments/materialize.ts`:

```ts
import type { Prisma } from "@/generated/prisma/client";
import type { CompiledWhere } from "./compile-sql";

const SEGMENT_TIMEOUT_MS = 60_000;

/** Reconcile one rule-segment's membership inside a transaction:
 *  1. upsert all current matches, stamping syncedAt = runStart
 *  2. sweep source='rule' rows whose syncedAt < runStart (no longer matching)
 *  Returns affected-row counts. The compiled WHERE's params occupy $1..$n; the
 *  fixed segmentName/runStart params are appended after them so the WHERE's
 *  placeholder numbering never needs rewriting. */
export async function materializeSegment(
  tx: Prisma.TransactionClient,
  args: { segmentName: string; where: CompiledWhere; runStart: Date },
): Promise<{ matched: number; deleted: number }> {
  const { segmentName, where, runStart } = args;

  // SET LOCAL only takes effect inside a transaction; guards a pathological WHERE.
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${SEGMENT_TIMEOUT_MS}`);

  const nameParam = `$${where.params.length + 1}`;
  const runStartParam = `$${where.params.length + 2}`;
  const insertSql =
    `INSERT INTO "UserSegment" (id, "externalId", "segmentName", "source", "syncedAt") ` +
    `SELECT gen_random_uuid()::text, u."externalId", ${nameParam}, 'rule', ${runStartParam} ` +
    `FROM "User" u WHERE ${where.sql} ` +
    `ON CONFLICT ("externalId", "segmentName", "source") DO UPDATE SET "syncedAt" = ${runStartParam}`;
  const matched = await tx.$executeRawUnsafe(insertSql, ...where.params, segmentName, runStart);

  const deleted = await tx.$executeRawUnsafe(
    `DELETE FROM "UserSegment" WHERE "segmentName" = $1 AND "source" = 'rule' AND "syncedAt" < $2`,
    segmentName,
    runStart,
  );

  return { matched, deleted };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:int -- materialize-segment`
Expected: PASS (all 3 cases — insert, sweep, hightouch-coexistence).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/materialize.ts tests/integration/materialize-segment.test.ts
git commit -m "feat(segments): materializeSegment upsert + watermark sweep reconcile"
```

---

## Task 4: `materializeAllSegments` (orchestrator)

Collect referenced names → load matching `Segment` rows → parse + compile each → run `materializeSegment` per segment in its own transaction with per-segment `try/catch` → aggregate a summary. Skips null/unparseable rules and rules that compile to `TRUE` (match-everyone guard).

**Files:**
- Modify: `src/lib/segments/materialize.ts`
- Test: `tests/integration/materialize-all-segments.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/materialize-all-segments.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { createUser, createAgent, createUserSegment } from "../helpers/builders";

const WAU_RULE = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "eq", value: "wau" }],
};

async function createSegment(name: string, rule: unknown) {
  return prisma.segment.create({ data: { name, rule: rule as Prisma.InputJsonValue } });
}

describe("materializeAllSegments", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
  });

  it("materializes a referenced rule-segment (happy path)", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createUser("mau-1", { funnelStage: "mau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsProcessed).toBe(1);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "rule" } });
    expect(rows.map((r) => r.externalId)).toEqual(["wau-1"]);
  });

  it("removes stale rule-members across runs", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });
    await materializeAllSegments({ runStart: new Date() });

    // User leaves the wau stage; next run should drop them.
    await prisma.trackedUser.update({ where: { externalId: "wau-1" }, data: { funnelStage: "mau" } });
    await materializeAllSegments({ runStart: new Date() });

    const rows = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "rule" } });
    expect(rows).toHaveLength(0);
  });

  it("leaves Hightouch rows intact under the same segmentName", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createUserSegment("ht-1", "wau-seg", "hightouch");
    await createSegment("wau-seg", WAU_RULE);
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    await materializeAllSegments({ runStart: new Date() });

    const ht = await prisma.userSegment.findMany({ where: { segmentName: "wau-seg", source: "hightouch" } });
    expect(ht.map((r) => r.externalId)).toEqual(["ht-1"]);
  });

  it("does not materialize segments no agent references", async () => {
    await createUser("wau-1", { funnelStage: "wau" });
    await createSegment("unreferenced", WAU_RULE);
    await createAgent({ segmentTargeting: null, targetSegmentName: null });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsProcessed).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "unreferenced" } });
    expect(rows).toHaveLength(0);
  });

  it("skips a segment whose rule is unparseable (never matches everyone)", async () => {
    await createUser("anyone", { funnelStage: "wau" });
    await createSegment("broken", { kind: "condition", fieldId: "nonexistent_field", operator: "eq", value: 1 });
    await createAgent({ segmentTargeting: { includes: ["broken"], excludes: [] } });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsSkipped).toBe(1);
    expect(summary.segmentsProcessed).toBe(0);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "broken" } });
    expect(rows).toHaveLength(0);
  });

  it("skips an empty rule that would compile to match-everyone", async () => {
    await createUser("anyone", { funnelStage: "wau" });
    await createSegment("empty", { kind: "group", join: "AND", children: [] });
    await createAgent({ segmentTargeting: { includes: ["empty"], excludes: [] } });

    const summary = await materializeAllSegments({ runStart: new Date() });

    expect(summary.segmentsSkipped).toBe(1);
    const rows = await prisma.userSegment.findMany({ where: { segmentName: "empty" } });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:int -- materialize-all-segments`
Expected: FAIL — `materializeAllSegments` not exported yet.

- [ ] **Step 3: Implement `materializeAllSegments` + `MaterializeSummary`**

Append to `src/lib/segments/materialize.ts`:

```ts
import { prisma } from "@/lib/db";
import { parseSegmentRule } from "./parse-rule";
import { compileSegmentRule } from "./compile-sql";

export type MaterializeSummary = {
  runStart: string;
  segmentsProcessed: number;
  segmentsSkipped: number; // null/unparseable rule, or a rule that matches everyone
  segmentsFailed: number; // threw during reconcile (timeout, SQL error)
  perSegment: { name: string; matched: number; deleted: number; error?: string }[];
};

export async function materializeAllSegments(args: { runStart: Date }): Promise<MaterializeSummary> {
  const { runStart } = args;

  const agents = await prisma.agent.findMany({
    select: { segmentTargeting: true, targetSegmentName: true },
  });
  const names = collectReferencedSegmentNames(agents);

  const summary: MaterializeSummary = {
    runStart: runStart.toISOString(),
    segmentsProcessed: 0,
    segmentsSkipped: 0,
    segmentsFailed: 0,
    perSegment: [],
  };

  if (names.size === 0) return summary;

  const segments = await prisma.segment.findMany({
    where: { name: { in: [...names] } },
    select: { name: true, rule: true },
  });

  for (const segment of segments) {
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
      const { matched, deleted } = await prisma.$transaction((tx) =>
        materializeSegment(tx, { segmentName: segment.name, where, runStart }),
      );
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

  return summary;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:int -- materialize-all-segments`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/materialize.ts tests/integration/materialize-all-segments.test.ts
git commit -m "feat(segments): materializeAllSegments orchestrator with skip/fail isolation"
```

---

## Task 5: Cron route

Thin handler: Bearer `CRON_SECRET` auth, call `materializeAllSegments`, persist a `CronRun`, return `{ data: summary }`.

**Files:**
- Create: `src/app/api/cron/materialize-segments/route.ts`
- Test: `tests/integration/cron-materialize-segments-route.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/cron-materialize-segments-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/cron/materialize-segments/route";
import { NextRequest } from "next/server";

function cronRequest(token: string | null): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/cron/materialize-segments", { method: "POST", headers });
}

describe("POST /api/cron/materialize-segments", () => {
  beforeEach(async () => {
    await prisma.cronRun.deleteMany({ where: { cronName: "materialize-segments" } });
  });

  it("rejects a missing/invalid bearer token with 401", async () => {
    const res = await POST(cronRequest(null));
    expect(res.status).toBe(401);
    const badRes = await POST(cronRequest("wrong-secret"));
    expect(badRes.status).toBe(401);
  });

  it("returns { data: summary } and writes a CronRun on valid auth", async () => {
    const res = await POST(cronRequest(process.env.CRON_SECRET ?? ""));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { runStart: string; segmentsProcessed: number } };
    expect(typeof json.data.runStart).toBe("string");
    expect(typeof json.data.segmentsProcessed).toBe("number");

    const runs = await prisma.cronRun.findMany({ where: { cronName: "materialize-segments" } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
  });
});
```

> This test reads `process.env.CRON_SECRET`. The integration env sets it; if it's unset locally the 200-path test will 401. Confirm `CRON_SECRET` is present in the test env (it is for the existing `select-and-send` integration tests) before finalizing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:int -- cron-materialize-segments-route`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/cron/materialize-segments/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";
import { materializeAllSegments, type MaterializeSummary } from "@/lib/segments/materialize";

// Allow up to 300s execution time on Vercel.
export const maxDuration = 300;

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback
  return token != null && constantTimeEqual(token, secret);
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<{ data: MaterializeSummary } | { error: string }>> {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runStart = new Date();
  try {
    const summary = await materializeAllSegments({ runStart });
    await prisma.cronRun.create({
      data: {
        cronName: "materialize-segments",
        startedAt: runStart,
        finishedAt: new Date(),
        status: "completed",
        agentCount: summary.segmentsProcessed,
        errors: summary.segmentsFailed,
      },
    });
    return NextResponse.json({ data: summary }, { status: 200 });
  } catch (err) {
    await prisma.cronRun
      .create({
        data: {
          cronName: "materialize-segments",
          startedAt: runStart,
          finishedAt: new Date(),
          status: "failed",
          errorMsg: err instanceof Error ? err.message : "unknown error",
        },
      })
      .catch(() => {});
    return NextResponse.json({ error: "Materialization failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test:int -- cron-materialize-segments-route`
Expected: PASS (401 path + 200/CronRun path).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/materialize-segments/route.ts tests/integration/cron-materialize-segments-route.test.ts
git commit -m "feat(cron): materialize-segments route (auth + CronRun + summary)"
```

---

## Task 6: Schedule + SQL-column regression + consumption proof

Wire the cron schedule, add the mandated raw-SQL column-name regression guard, and prove `select-and-send` consumes rule-materialized members unchanged.

**Files:**
- Modify: `vercel.json:8-25` (crons array)
- Create: `tests/regression/materialize-segments-sql-columns.test.ts`
- Create: `tests/integration/select-and-send-consumes-rule-segments.test.ts`

- [ ] **Step 1: Add the cron entry to `vercel.json`**

In `vercel.json`, add to the `crons` array (runs at :45 so membership is fresh before the top-of-hour `select-and-send`):

```json
{ "path": "/api/cron/materialize-segments", "schedule": "45 * * * *" }
```

Keep the existing entries intact; just append this object to the array.

- [ ] **Step 2: Write the SQL column-name regression test**

Create `tests/regression/materialize-segments-sql-columns.test.ts`:

```ts
// Regression (CLAUDE.md: every new $executeRawUnsafe needs a column-name guard).
// The materialize reconcile hand-writes INSERT…SELECT / DELETE against "UserSegment"
// and "User". A rename of externalId / segmentName / source / syncedAt would break it
// silently outside this test. Running the real reconcile + reading every column back
// proves all four column names (and the "User".externalId / funnelStage refs) are valid.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { materializeSegment } from "@/lib/segments/materialize";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { createUser } from "../helpers/builders";
import type { SegmentRule } from "@/types/segment";

const WAU_RULE: SegmentRule = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "eq", value: "wau" }],
};

describe("materialize reconcile SQL column names", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
  });

  it("reads back every column the raw SQL writes", async () => {
    await createUser("col-1", { funnelStage: "wau" });
    const where = compileSegmentRule(WAU_RULE);
    const runStart = new Date();

    await prisma.$transaction((tx) => materializeSegment(tx, { segmentName: "cols", where, runStart }));

    // Explicit raw SELECT of each column name proves they exist post-write.
    const rows = await prisma.$queryRawUnsafe<
      Array<{ externalId: string; segmentName: string; source: string; syncedAt: Date }>
    >(`SELECT "externalId", "segmentName", "source", "syncedAt" FROM "UserSegment" WHERE "segmentName" = $1`, "cols");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalId).toBe("col-1");
    expect(rows[0]?.segmentName).toBe("cols");
    expect(rows[0]?.source).toBe("rule");
    expect(rows[0]?.syncedAt).toBeInstanceOf(Date);
  });

  it("is idempotent: re-running with a later runStart keeps the member, no duplicate", async () => {
    await createUser("col-1", { funnelStage: "wau" });
    const where = compileSegmentRule(WAU_RULE);

    await prisma.$transaction((tx) => materializeSegment(tx, { segmentName: "cols", where, runStart: new Date(Date.now() - 1000) }));
    await prisma.$transaction((tx) => materializeSegment(tx, { segmentName: "cols", where, runStart: new Date() }));

    const rows = await prisma.userSegment.findMany({ where: { segmentName: "cols", source: "rule" } });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Write the consumption proof test**

Create `tests/integration/select-and-send-consumes-rule-segments.test.ts`:

```ts
// Proves the C3 payoff: select-and-send reads UserSegment by segmentName alone
// (src/app/api/cron/select-and-send/route.ts), so rule-materialized members
// (source='rule') are picked up with NO change to that route. We assert the exact
// query select-and-send runs returns the materialized members.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { createUser, createAgent, createUserSegment } from "../helpers/builders";

const WAU_RULE = {
  kind: "group",
  join: "AND",
  children: [{ kind: "condition", fieldId: "funnelStage", operator: "eq", value: "wau" }],
};

describe("select-and-send consumes rule-materialized segments", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.segment.deleteMany();
  });

  it("the segmentName-only membership query returns both rule and hightouch members", async () => {
    await createUser("rule-wau", { funnelStage: "wau" });
    await createUserSegment("ht-extra", "wau-seg", "hightouch");
    await prisma.segment.create({ data: { name: "wau-seg", rule: WAU_RULE as Prisma.InputJsonValue } });
    await createAgent({ segmentTargeting: { includes: ["wau-seg"], excludes: [] } });

    await materializeAllSegments({ runStart: new Date() });

    // This is exactly how select-and-send resolves an include segment:
    const rows = await prisma.userSegment.findMany({
      where: { segmentName: "wau-seg" },
      select: { externalId: true },
    });
    const members = new Set(rows.map((r) => r.externalId));
    expect(members).toEqual(new Set(["rule-wau", "ht-extra"]));
  });
});
```

- [ ] **Step 4: Run the new tests**

Run: `bun run test:int -- materialize-segments-sql-columns select-and-send-consumes-rule-segments`
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add vercel.json tests/regression/materialize-segments-sql-columns.test.ts \
  tests/integration/select-and-send-consumes-rule-segments.test.ts
git commit -m "feat(cron): schedule materialize-segments + SQL-column + consumption tests"
```

---

## Task 7: Full check + ship

**Files:** none (verification + ship)

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: typecheck + lint + full integration/regression suite all green.

- [ ] **Step 2: Apply the migration to PROD via idempotent DDL (NOT migrate dev)**

Load `DATABASE_URL_UNPOOLED` from `.env.local` and apply the same migration SQL:

```bash
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -f prisma/migrations/20260607180000_add_usersegment_source/migration.sql
```

Then reconcile Prisma's migration history without re-running DDL:

```bash
npx prisma migrate resolve --applied 20260607180000_add_usersegment_source
npx prisma migrate status   # expect: "Database schema is up to date!"
```

> Before running, confirm the prod unique index name matches `UserSegment_externalId_segmentName_key` (Prisma default). If prod named it differently, the `DROP INDEX IF EXISTS` is a no-op and the old 2-col unique would linger — verify with:
> `psql "$DATABASE_URL_UNPOOLED" -c "SELECT indexname FROM pg_indexes WHERE tablename='UserSegment';"`

- [ ] **Step 3: Push the branch and open the MR**

```bash
git push -u origin HEAD
glab mr create --fill --yes
```

- [ ] **Step 4: Poll until mergeable, then merge**

```bash
glab api projects/lifechurch%2Fyouversion%2Fmarketing-group%2Fnexus/merge_requests/<N> \
  --jq '.detailed_merge_status'
# repeat until "mergeable", then:
glab mr merge <N> --yes
```

---

## Self-Review

**1. Spec coverage:**
- Trigger = separate Vercel cron → Task 5 route + Task 6 `vercel.json`. ✅
- `source` column + widened unique → Task 1. ✅
- Job writes/deletes only `source='rule'`; ingest writes `source='hightouch'` → Task 1 (ingest) + Task 3 (reconcile filters `source='rule'`). ✅
- `select-and-send` queries by `segmentName` alone, unchanged → Task 6 consumption test (and no edit to that route anywhere in the plan). ✅
- Materialize only agent-referenced segments → Task 2 + Task 4 (`findMany where name in names`). ✅
- Approach A reconcile (INSERT…SELECT…ON CONFLICT + watermark sweep, `gen_random_uuid()`) → Task 3. ✅
- Per-segment `try/catch` + `SET LOCAL statement_timeout` → Task 3 (timeout) + Task 4 (try/catch). ✅
- Null/unparseable rule skipped; never match-everyone → Task 4 (null guard + `where.sql === "TRUE"` guard). ✅
- Empty-match deletes all rule rows, HT rows survive → Task 3 + Task 4 tests. ✅
- `CronRun` persistence + `{ data: summary }` → Task 5. ✅
- All mandated tests (unit/integration/regression incl. SQL-column guard + ingest-key regression + consumption) → Tasks 2-6. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". The `<N>` for the MR number in Task 7 is a runtime value, not a code placeholder. ✅

**3. Type consistency:** `materializeSegment(tx, { segmentName, where, runStart })` returns `{ matched, deleted }` — same shape consumed in Task 4. `MaterializeSummary` fields (`runStart`, `segmentsProcessed`, `segmentsSkipped`, `segmentsFailed`, `perSegment`) defined in Task 4, consumed identically in Task 5 (`agentCount: summary.segmentsProcessed`, `errors: summary.segmentsFailed`). `collectReferencedSegmentNames` signature (Task 2) matches its call in Task 4 (`prisma.agent.findMany` selecting `segmentTargeting` + `targetSegmentName`). `CompiledWhere` import from `./compile-sql` matches the real export. ✅
