# Agent Cohort Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent has `uniqueUsersCap = N`, materialize a fixed cohort of N users on the first cron tick after it goes active, then experiment on that whole cohort immediately (gated only by `dailySendCap` + per-user gates) instead of trickling users in over weeks; remove the now-redundant `audienceCap` ("Per-run rollout limit").

**Architecture:** The authoritative `POST /agents` (Hono service, `apps/api/`) needs **no change** — a new agent is born with `cohortAssignedAt = null`. The Next.js cron (`src/app/api/cron/select-and-send/route.ts`) does all the work: it detects un-materialized active agents, randomly samples N eligible users (skipping users locked to other agents — already the pool's behavior), bulk-creates `UserAgentAssignment` rows + sets `lockedByAgentId`, and stamps `cohortAssignedAt`. Once materialized, the agent's eligible query is restricted to its own locked cohort (it stops recruiting). `audienceCap` is removed everywhere; the per-run DB fetch bound is re-derived from `dailySendCap`/`uniqueUsersCap`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma v7 + PostgreSQL (Neon prod / local `nexus_test`), Hono (apps/api service), bun:test.

---

## Background the implementer must know

**Two-DB migration rule (read `CLAUDE.md` + memory):** NEVER run `prisma migrate dev` against prod — it proposes a destructive RESET on drift. Apply schema changes with **idempotent DDL** (`ALTER TABLE ... ADD/DROP COLUMN IF [NOT] EXISTS`) to the **local `nexus_test`** DB only in this plan; production application is a deploy-time step (call it out, do not run it). After editing `prisma/schema.prisma`, regenerate both clients: root (`npx prisma generate`) and the service (`cd apps/api && bun run generate`) — there are two generated clients.

**Local test DB & service env bleed (memory):** Integration tests use local `nexus_test` (a plain local Postgres; `db.ts` auto-selects the `PrismaPg` adapter for localhost). `bun:test` reads the test env. If you ever boot `apps/api` by hand, override `PGUSER`/`PGPASSWORD`/`PGHOST`/`PGDATABASE` on the CLI or `.env.local` (prod) bleeds in.

**Test commands:** `bun run test:quick` (unit + contract, no DB) during iteration; `bun run check` (typecheck + lint + full integration + regression) before finishing. Use `bun test <path>` to run one file. Use builders in `tests/helpers/builders.ts` for DB rows.

**Key current behavior the cron already has (do not re-derive):**
- Cron loads only `status: "active"` agents (route.ts:108-109).
- Fleet exclusivity: `activeOwnerByUser` (route.ts:208-215) maps `externalUserId → owning agentId` from active `UserAgentAssignment` rows; the eligible-pool build already drops users owned by another agent (route.ts:309-312, 342-345). **This is the "skip users locked elsewhere" behavior — reuse it, don't reinvent.**
- The eligible-pool build runs once per run inside a `Promise.all` (route.ts:224-358) and fills `eligibleUsersByAgent: Map<agentId, externalId[]>`.
- Per-agent processing (route.ts:450+) does, in order: lottery-assigned users → `selectAudience` (audienceCap) → `dailySendCap` trim → `uniqueUsersCap` trim → lock via `trackedUser.updateMany`.

**Decisions locked with the user (do not revisit):**
1. Materialization happens on the **next cron tick** (bulk), not synchronously at create and not via a button.
2. Selecting the cohort **skips** users locked/owned by another agent (no preemption).
3. Cohort members are chosen by **random sample**.
4. Exploration windows are **unchanged** (NOT extended to lapsed_wau/dau4).
5. **Existing active agents auto-materialize** on the next tick (no backfill of `cohortAssignedAt`). This intentionally fixes Neo/Morpheus.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `prisma/schema.prisma` | Models | Add `Agent.cohortAssignedAt DateTime?`; remove `Agent.audienceCap` |
| `prisma/migrations/<ts>_agent_cohort_assignment/migration.sql` | Idempotent DDL | Create (ADD cohortAssignedAt) |
| `prisma/migrations/<ts>_drop_audience_cap/migration.sql` | Idempotent DDL | Create (DROP audienceCap) |
| `src/lib/cron/caps.ts` | Pure cap/fetch helpers | Drop `audienceCap` from `resolveFetchLimit`; replace `selectAudience` (cap) with `partitionByPreferredHour` (no cap, preserves hour-deferral) |
| `src/lib/cron/cohort-assignment.ts` | **New.** Pure cohort selection (random sample, RNG-injectable) | Create |
| `src/app/api/cron/select-and-send/route.ts` | Cron orchestration | Cohort-aware eligible query; materialization phase; remove audienceCap usage; use `partitionByPreferredHour` |
| `src/app/api/agents/[id]/route.ts` | PATCH agent | Remove audienceCap validation/update; on lock-release reset cohort (`cohortAssignedAt=null` + release assignments) |
| `src/components/agents/audience-cap-editor.tsx` | UI editor | **Delete** |
| `src/app/agents/[id]/page.tsx` | Detail page | Remove `<AudienceCapEditor>` render |
| `src/lib/cache/agents.ts` | Card stats | Add per-agent active-assignment ("Assigned") count |
| `src/components/agents/agent-card.tsx` | Card UI | Show "Assigned: N" distinct from reach |
| `scripts/trace-agent-send-gates.ts` | Debug script | Remove audienceCap references |
| `tests/unit/cron-caps.test.ts` | Unit | Rewrite for new `resolveFetchLimit` + `partitionByPreferredHour` |
| `tests/unit/cohort-assignment.test.ts` | **New.** Unit | Create |
| `tests/integration/cron-cohort-materialization.test.ts` | **New.** Integration | Create |
| `tests/integration/agents-patch-audience-cap-removed.test.ts` | **New.** Integration/regression | Create |

---

### Task 1: Add `cohortAssignedAt` to the schema (additive, safe)

**Files:**
- Modify: `prisma/schema.prisma:39` (add field in the `Agent` model, near `createdAt`)
- Create: `prisma/migrations/<timestamp>_agent_cohort_assignment/migration.sql`

- [ ] **Step 1: Add the field to the Agent model**

In `prisma/schema.prisma`, inside `model Agent`, add the line immediately after `dailySendCap` (line 29):

```prisma
  cohortAssignedAt DateTime?   // set when the cron materializes this agent's fixed cohort; null = not yet materialized
```

- [ ] **Step 2: Write the idempotent migration SQL**

Create `prisma/migrations/<timestamp>_agent_cohort_assignment/migration.sql` (use a real timestamp prefix like `20260604120000`):

```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "cohortAssignedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Apply to the local test DB**

Run:
```bash
psql -d nexus_test -c 'ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "cohortAssignedAt" TIMESTAMP(3);'
```
Expected: `ALTER TABLE`.

- [ ] **Step 4: Regenerate both Prisma clients**

Run:
```bash
npx prisma generate && (cd apps/api && bun run generate)
```
Expected: both report "Generated Prisma Client". (Service client must know the field for Task 6 cross-checks even though create doesn't set it.)

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no references yet; just confirms client regenerated cleanly).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated apps/api/src/generated
git commit -m "feat(schema): add Agent.cohortAssignedAt for cohort materialization"
```

> **Deploy note (do NOT run here):** Production application of this migration is `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "cohortAssignedAt" TIMESTAMP(3);` run against prod + `npx prisma migrate resolve --applied <migration_name>`. Additive + nullable = safe.

---

### Task 2: Refactor `caps.ts` — drop audienceCap, preserve hour-deferral

`resolveFetchLimit` currently takes `audienceCap`. The per-run DB fetch bound must instead come from `dailySendCap` and `uniqueUsersCap` (so an un-materialized agent fetches enough candidates to sample N). `selectAudience` (which both caps AND does prioritizeLastSeen hour-deferral) is replaced by `partitionByPreferredHour` — same hour-deferral, **no numeric cap** (the per-run throttle is gone; `dailySendCap` is the ramp knob now).

**Files:**
- Modify: `src/lib/cron/caps.ts`
- Test: `tests/unit/cron-caps.test.ts`

- [ ] **Step 1: Rewrite the unit test file**

Replace the entire contents of `tests/unit/cron-caps.test.ts` with:

```typescript
import { describe, it, expect } from "bun:test";
import {
  partitionByPreferredHour,
  trimToCap,
  resolveFetchLimit,
  MAX_FETCH_LIMIT,
} from "@/lib/cron/caps";

describe("resolveFetchLimit", () => {
  it("uses uniqueUsersCap when it is the larger driver (cohort needs N candidates)", () => {
    expect(resolveFetchLimit(500, 1000)).toBe(1000);
  });

  it("uses 2x dailySendCap when it exceeds uniqueUsersCap", () => {
    expect(resolveFetchLimit(800, 1000)).toBe(1600);
  });

  it("uses 2x dailySendCap when uniqueUsersCap is null", () => {
    expect(resolveFetchLimit(500, null)).toBe(1000);
  });

  it("uses uniqueUsersCap when dailySendCap is null", () => {
    expect(resolveFetchLimit(null, 1000)).toBe(1000);
  });

  it("falls back to the safety ceiling when both are null (explicit-unlimited)", () => {
    expect(resolveFetchLimit(null, null)).toBe(MAX_FETCH_LIMIT);
  });

  it("never exceeds the safety ceiling", () => {
    expect(resolveFetchLimit(null, 200_000)).toBe(MAX_FETCH_LIMIT);
  });
});

describe("trimToCap", () => {
  it("keeps everything when under quota", () => {
    expect(trimToCap(["a", "b"], 5)).toEqual({ kept: ["a", "b"], suppressed: 0 });
  });

  it("trims to the remaining quota and reports suppressed count", () => {
    expect(trimToCap(["a", "b", "c", "d"], 2)).toEqual({ kept: ["a", "b"], suppressed: 2 });
  });

  it("drops everything when remaining is zero or negative", () => {
    expect(trimToCap(["a", "b"], 0)).toEqual({ kept: [], suppressed: 2 });
    expect(trimToCap(["a", "b"], -3)).toEqual({ kept: [], suppressed: 2 });
  });
});

describe("partitionByPreferredHour", () => {
  it("returns everyone (no deferral) when prioritizeLastSeen is false", () => {
    const res = partitionByPreferredHour(["a", "b", "c"], {
      prioritizeLastSeen: false,
      currentHour: 12,
      preferredHourByUser: new Map(),
    });
    expect(res.kept.sort()).toEqual(["a", "b", "c"]);
    expect(res.deferred).toBe(0);
  });

  it("keeps time-matched + no-preference users, defers far-hour users (not suppressed)", () => {
    const preferred = new Map<string, number | null>([
      ["match-now", 12],
      ["match-adjacent", 13],
      ["far", 3],
      ["no-pref", null],
    ]);
    const res = partitionByPreferredHour(["match-now", "match-adjacent", "far", "no-pref"], {
      prioritizeLastSeen: true,
      currentHour: 12,
      preferredHourByUser: preferred,
    });
    expect(res.kept.sort()).toEqual(["match-adjacent", "match-now", "no-pref"]);
    expect(res.deferred).toBe(1);
  });

  it("wraps adjacency across midnight", () => {
    const preferred = new Map<string, number | null>([["late", 23]]);
    const res = partitionByPreferredHour(["late"], {
      prioritizeLastSeen: true,
      currentHour: 0,
      preferredHourByUser: preferred,
    });
    expect(res.kept).toEqual(["late"]);
    expect(res.deferred).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/cron-caps.test.ts`
Expected: FAIL — `partitionByPreferredHour` is not exported and `resolveFetchLimit` signature differs.

- [ ] **Step 3: Rewrite `caps.ts`**

Replace the contents of `src/lib/cron/caps.ts` with (keeps `shuffle`, `hoursAdjacent`, `trimToCap`, `MAX_FETCH_LIMIT` unchanged in spirit):

```typescript
/**
 * Pure audience helpers for the select-and-send cron. No DB access — the
 * orchestrator supplies counts and applies the returned trims.
 */

/** True when two clock hours are within ±1, wrapping across midnight. */
function hoursAdjacent(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 - diff) <= 1;
}

/**
 * Hard ceiling on rows pulled per agent per cron run. Guards the all-null
 * "unlimited" case so a query can never be unbounded and blow the 300s timeout.
 */
export const MAX_FETCH_LIMIT = 50_000;

/**
 * Decide how many eligible users to pull from the DB for one agent in one run.
 * Cohort agents need at least `uniqueUsersCap` candidates to sample N; send-rate
 * agents need ~2x `dailySendCap` for suppression headroom. Take the larger of the
 * two drivers; when both are null the agent is unlimited, so fall back to the
 * safety ceiling. Result is always bounded by MAX_FETCH_LIMIT.
 */
export function resolveFetchLimit(dailySendCap: number | null, uniqueUsersCap: number | null): number {
  const fromDaily = dailySendCap != null ? dailySendCap * 2 : 0;
  const fromCohort = uniqueUsersCap != null ? uniqueUsersCap : 0;
  const want = Math.max(fromDaily, fromCohort);
  if (want === 0) return MAX_FETCH_LIMIT;
  return Math.min(want, MAX_FETCH_LIMIT);
}

/**
 * Trim a list to a remaining quota. `remaining <= 0` drops everything; otherwise
 * keeps the first `remaining`. Returns the kept ids and how many were dropped.
 */
export function trimToCap(userIds: string[], remaining: number): { kept: string[]; suppressed: number } {
  if (remaining <= 0) return { kept: [], suppressed: userIds.length };
  if (userIds.length > remaining) return { kept: userIds.slice(0, remaining), suppressed: userIds.length - remaining };
  return { kept: userIds, suppressed: 0 };
}

export type HourPartition = { kept: string[]; deferred: number };

/**
 * Preserve send-timing fairness without a per-run cap. When `prioritizeLastSeen`
 * is on, keep users whose preferred send hour is within ±1 of the current UTC hour
 * (plus users with no preference); users whose preferred hour is far from now are
 * DEFERRED to their matching hourly run (NOT suppressed — they send later today).
 * When off, everyone is kept. No numeric ceiling — `dailySendCap` is the ramp knob.
 */
export function partitionByPreferredHour(
  userIds: string[],
  opts: {
    prioritizeLastSeen: boolean;
    currentHour: number;
    preferredHourByUser: Map<string, number | null>;
  },
): HourPartition {
  const { prioritizeLastSeen, currentHour, preferredHourByUser } = opts;
  if (!prioritizeLastSeen) return { kept: [...userIds], deferred: 0 };

  const kept: string[] = [];
  let deferred = 0;
  for (const uid of userIds) {
    const h = preferredHourByUser.get(uid);
    if (h !== null && h !== undefined) {
      if (hoursAdjacent(h, currentHour)) kept.push(uid);
      else deferred++; // deferred to its matching hourly run — not suppressed
    } else {
      kept.push(uid); // no preference → eligible now
    }
  }
  return { kept, deferred };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/cron-caps.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/caps.ts tests/unit/cron-caps.test.ts
git commit -m "refactor(cron/caps): drop audienceCap; fetch bound from daily/unique caps; hour-deferral keeps no cap"
```

---

### Task 3: New pure cohort-selection helper

A pure, RNG-injectable function that picks up to N members from an eligible pool. Kept pure (no DB) so it is unit-testable per the repo's engine convention.

**Files:**
- Create: `src/lib/cron/cohort-assignment.ts`
- Test: `tests/unit/cohort-assignment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cohort-assignment.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { selectCohort } from "@/lib/cron/cohort-assignment";

// Deterministic RNG that returns 0 → Fisher-Yates is a no-op (stable order).
const noShuffle = () => 0;

describe("selectCohort", () => {
  it("returns all eligible users when pool is smaller than the cap", () => {
    expect(selectCohort(["a", "b", "c"], 10, noShuffle).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns exactly N when pool exceeds the cap", () => {
    const picked = selectCohort(["a", "b", "c", "d", "e"], 3, noShuffle);
    expect(picked).toHaveLength(3);
    // every picked id came from the pool
    for (const id of picked) expect(["a", "b", "c", "d", "e"]).toContain(id);
  });

  it("returns an empty array when the pool is empty", () => {
    expect(selectCohort([], 100, noShuffle)).toEqual([]);
  });

  it("returns an empty array when cap is zero or negative", () => {
    expect(selectCohort(["a", "b"], 0, noShuffle)).toEqual([]);
    expect(selectCohort(["a", "b"], -1, noShuffle)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const pool = ["a", "b", "c"];
    selectCohort(pool, 2, Math.random);
    expect(pool).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/cohort-assignment.test.ts`
Expected: FAIL with "Cannot find module '@/lib/cron/cohort-assignment'".

- [ ] **Step 3: Implement**

Create `src/lib/cron/cohort-assignment.ts`:

```typescript
/**
 * Pure cohort selection for the select-and-send cron. Given an already-filtered
 * pool of eligible externalIds (persona/funnel/segment/consent + fleet-exclusivity
 * applied upstream), randomly sample up to `cap` of them. No DB access; RNG
 * injectable for deterministic tests.
 */

/** Fisher-Yates shuffle on a copy. RNG injectable. */
function shuffled<T>(arr: readonly T[], random: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Randomly select up to `cap` members from `eligible`. Returns all of them when
 * the pool is smaller than the cap; empty when the pool is empty or cap <= 0.
 */
export function selectCohort(
  eligible: readonly string[],
  cap: number,
  random: () => number = Math.random,
): string[] {
  if (cap <= 0 || eligible.length === 0) return [];
  if (eligible.length <= cap) return [...eligible];
  return shuffled(eligible, random).slice(0, cap);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/cohort-assignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/cohort-assignment.ts tests/unit/cohort-assignment.test.ts
git commit -m "feat(cron): pure selectCohort helper for cohort materialization"
```

---

### Task 4: Cron — cohort-aware eligible query, materialization phase, remove audienceCap usage

This is the core wiring. Three edits to `src/app/api/cron/select-and-send/route.ts`:
(A) the eligible-pool build branches on `cohortAssignedAt`; (B) a new sequential materialization phase after the pool build and before `buildAgentLottery`; (C) remove the `selectAudience`/`audienceCap` block in per-agent processing, replacing it with `partitionByPreferredHour`.

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`

- [ ] **Step 1: Update the caps import**

Find the import of the caps helpers (it currently imports `selectAudience`, `trimToCap`, `resolveFetchLimit`). Change it to:

```typescript
import { partitionByPreferredHour, trimToCap, resolveFetchLimit, MAX_FETCH_LIMIT } from "@/lib/cron/caps";
import { selectCohort } from "@/lib/cron/cohort-assignment";
```

- [ ] **Step 2: Make the funnel-stage eligible query cohort-aware**

In the eligible-pool build (route.ts ~318-351, the `else` funnel-stage path), replace the `fetchLimit` line and the `where` OR clause so a materialized agent pulls ONLY its own locked cohort, and the fetch bound comes from the new `resolveFetchLimit` signature.

Replace:
```typescript
          const fetchLimit = resolveFetchLimit(agent.audienceCap, agent.dailySendCap);
          let rows = await prisma.trackedUser.findMany({
            where:  {
              personaId: { in: personaIds },
              ...langFilter,
              ...funnelFilter,
              OR: [
                { lockedByAgentId: null },
                { lockedByAgentId: agent.id },
              ],
            },
            select: { externalId: true, preferredSendHour: true },
            take: fetchLimit,
          });
```
with:
```typescript
          const fetchLimit = resolveFetchLimit(agent.dailySendCap, agent.uniqueUsersCap);
          // Materialized cohort agents process ONLY their own locked cohort — they
          // stop recruiting. Un-materialized agents pull the recruitable pool.
          const lockClause = agent.cohortAssignedAt
            ? { lockedByAgentId: agent.id }
            : { OR: [{ lockedByAgentId: null }, { lockedByAgentId: agent.id }] };
          let rows = await prisma.trackedUser.findMany({
            where:  {
              personaId: { in: personaIds },
              ...langFilter,
              ...funnelFilter,
              ...lockClause,
            },
            select: { externalId: true, preferredSendHour: true },
            take: fetchLimit,
          });
```

- [ ] **Step 3: Make the segment-path eligible query cohort-aware**

In the segment path (route.ts ~298-308), replace the `trackedUser.findMany` `where` OR clause the same way. Replace:
```typescript
          const rows = await prisma.trackedUser.findMany({
            where: {
              externalId: { in: memberIds },
              personaId:  { in: personaIds },
              OR: [
                { lockedByAgentId: null },
                { lockedByAgentId: agent.id },
              ],
            },
            select: { externalId: true, preferredSendHour: true },
          });
```
with:
```typescript
          const segLockClause = agent.cohortAssignedAt
            ? { lockedByAgentId: agent.id }
            : { OR: [{ lockedByAgentId: null }, { lockedByAgentId: agent.id }] };
          const rows = await prisma.trackedUser.findMany({
            where: {
              externalId: { in: memberIds },
              personaId:  { in: personaIds },
              ...segLockClause,
            },
            select: { externalId: true, preferredSendHour: true },
          });
```

- [ ] **Step 4: Add the materialization phase**

Immediately AFTER the `const [, cooldownSetting, ...] = await Promise.all([...])` block that fills `eligibleUsersByAgent` (i.e. right after route.ts:358, before the `pushTargetingMode` resolution at line 360), insert a new sequential phase. It runs per un-materialized cohort agent, locks via a null-guarded `updateMany` (race-safe across agents in the same run), creates assignments for exactly the users that got locked, stamps `cohortAssignedAt`, and rewrites that agent's eligible list to its locked cohort:

```typescript
  // ─── Cohort materialization ───────────────────────────────────────────────
  // First tick after an agent goes active: pick a fixed cohort of up to
  // uniqueUsersCap eligible users, lock them, and record assignments. Sequential
  // (not parallel) so each agent's locks are visible to the next; the null-guarded
  // updateMany is the arbiter when two new agents contend for the same users.
  for (const agent of agents) {
    if (agent.cohortAssignedAt) continue;          // already materialized
    if (agent.uniqueUsersCap == null) continue;     // unlimited agents never materialize
    const pool = eligibleUsersByAgent.get(agent.id) ?? [];
    if (pool.length === 0) continue;                // nothing eligible yet; retry next tick

    const sample = selectCohort(pool, agent.uniqueUsersCap);
    // Lock only users not already locked by anyone — race-safe.
    await prisma.trackedUser.updateMany({
      where: { externalId: { in: sample }, lockedByAgentId: null },
      data:  { lockedByAgentId: agent.id },
    });
    // Re-read which ones we actually own now (covers concurrent contention).
    const lockedRows = await prisma.trackedUser.findMany({
      where: { externalId: { in: sample }, lockedByAgentId: agent.id },
      select: { externalId: true },
    });
    const lockedIds = lockedRows.map((r) => r.externalId);
    if (lockedIds.length > 0) {
      await prisma.userAgentAssignment.createMany({
        data: lockedIds.map((externalUserId) => ({ externalUserId, agentId: agent.id, startedAt: now })),
        skipDuplicates: true,
      });
      for (const id of lockedIds) activeOwnerByUser.set(id, agent.id);
    }
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: now } });
    agent.cohortAssignedAt = now; // keep in-memory agent consistent for the rest of this run
    // This agent now processes only its locked cohort this run.
    eligibleUsersByAgent.set(agent.id, lockedIds);
    preferredHourByAgent.delete(agent.id); // hour map rebuilt lazily; cohort uses default ordering this run
  }
  // ─── End cohort materialization ───────────────────────────────────────────
```

- [ ] **Step 5: Replace the audienceCap block in per-agent processing**

In the per-agent loop (route.ts 464-475), replace the audienceCap `selectAudience` block:
```typescript
    // Apply audience cap — time-bucketed selection when prioritizeLastSeen is on (default),
    // otherwise fall back to Fisher-Yates random shuffle.
    if (agent.audienceCap !== null && agent.audienceCap !== undefined) {
      const selection = selectAudience(lotteryUserIds, {
        audienceCap: agent.audienceCap,
        prioritizeLastSeen: agent.schedulingRule?.prioritizeLastSeen !== false,
        currentHour: now.getUTCHours(),
        preferredHourByUser: preferredHourByAgent.get(agent.id) ?? new Map<string, number | null>(),
      });
      lotteryUserIds = selection.kept;
      suppress.audienceCap = selection.suppressed;
    }
```
with (no cap; preserve hour-deferral only):
```typescript
    // Send-timing fairness: when prioritizeLastSeen is on, hold back users whose
    // preferred hour is far from now (they send in their matching hourly run).
    // No per-run ceiling — dailySendCap is the ramp knob.
    {
      const partition = partitionByPreferredHour(lotteryUserIds, {
        prioritizeLastSeen: agent.schedulingRule?.prioritizeLastSeen !== false,
        currentHour: now.getUTCHours(),
        preferredHourByUser: preferredHourByAgent.get(agent.id) ?? new Map<string, number | null>(),
      });
      lotteryUserIds = partition.kept;
    }
```

- [ ] **Step 6: Remove the now-dead `audienceCap` suppress counter**

In route.ts:454, remove `audienceCap: 0,` from the `suppress` object literal. Then grep the file for any remaining `suppress.audienceCap` or `.audienceCap` reference and remove/adjust (there should be none after Step 5). If `suppress` is serialized into a metric/log with a fixed shape, drop the `audienceCap` key there too.

Run: `grep -n "audienceCap" src/app/api/cron/select-and-send/route.ts`
Expected: no matches.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (`MAX_FETCH_LIMIT` is imported; if unused after edits, drop it from the import to satisfy lint.)

- [ ] **Step 8: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat(cron): materialize fixed cohort per agent; cohort-only processing after; drop audienceCap"
```

---

### Task 5: Integration tests for cron materialization

Verify: (a) an active funnel-stage agent materializes exactly `uniqueUsersCap` assignments + locks on a run; (b) a second run does NOT re-materialize (count stable, `cohortAssignedAt` unchanged); (c) after materialization the agent ignores newly-eligible unlocked users (stops recruiting); (d) users locked to another agent are skipped.

**Files:**
- Create: `tests/integration/cron-cohort-materialization.test.ts`

- [ ] **Step 1: Inspect the cron test harness + builders**

Read an existing cron integration test (e.g. `ls tests/integration | grep -i cron`, then open one) to copy its setup: how it imports/calls the `GET`/`POST` route handler, how it authenticates (`CRON_SECRET` header), how it seeds `TrackedUser`/`Agent`/`Persona`/`AgentPersonaTarget`/`SchedulingRule` via `tests/helpers/builders.ts`, and how it mocks Braze so no real send happens. Mirror that harness exactly — do not invent a new one.

- [ ] **Step 2: Write the test**

Create `tests/integration/cron-cohort-materialization.test.ts`. Adapt the imports/auth/Braze-mock to match the harness found in Step 1; the assertions below are the contract:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
// import the cron route handler + helpers the same way the existing cron test does
// import { GET as runCron } from "@/app/api/cron/select-and-send/route";
// import { makeCronRequest, seedPersona, seedTrackedUsers, seedAgent } from helpers

describe("cron cohort materialization", () => {
  beforeEach(async () => {
    // truncate via the project's standard cleanup (deleteMany in child→parent order)
  });

  it("materializes exactly uniqueUsersCap assignments + locks on the first run", async () => {
    // seed a persona, 50 TrackedUsers in funnelStage "lapsed_wau" with that persona,
    // newsletter_push_enabled, language en, unlocked, no active assignment
    // seed an ACTIVE agent: funnelStage "lapsed_wau", uniqueUsersCap 20, dailySendCap 500,
    //   one persona target, one complete push message+variant, schedulingRule present
    // (agent.cohortAssignedAt is null by default)

    // await runCron(makeCronRequest());

    const agent = await prisma.agent.findFirstOrThrow({ where: { name: /* seeded name */ "" } });
    expect(agent.cohortAssignedAt).not.toBeNull();

    const assignments = await prisma.userAgentAssignment.count({
      where: { agentId: agent.id, releasedAt: null },
    });
    expect(assignments).toBe(20);

    const locked = await prisma.trackedUser.count({ where: { lockedByAgentId: agent.id } });
    expect(locked).toBe(20);
  });

  it("does not re-materialize on a second run", async () => {
    // seed as above, run cron twice
    // await runCron(makeCronRequest());
    const agent1 = await prisma.agent.findFirstOrThrow({ where: { /* seeded */ } });
    const firstStamp = agent1.cohortAssignedAt;
    // await runCron(makeCronRequest());
    const agent2 = await prisma.agent.findFirstOrThrow({ where: { id: agent1.id } });
    expect(agent2.cohortAssignedAt?.getTime()).toBe(firstStamp?.getTime());
    const count = await prisma.userAgentAssignment.count({ where: { agentId: agent1.id, releasedAt: null } });
    expect(count).toBe(20);
  });

  it("stops recruiting: new eligible unlocked users are not added after materialization", async () => {
    // seed 20 users + agent (cap 20), run once → cohort of 20 locked.
    // insert 30 MORE eligible unlocked users in the same funnelStage/persona.
    // run cron again.
    // assignments for the agent stay at 20; the 30 new users remain unlocked.
    const agent = await prisma.agent.findFirstOrThrow({ where: { /* seeded */ } });
    const count = await prisma.userAgentAssignment.count({ where: { agentId: agent.id, releasedAt: null } });
    expect(count).toBe(20);
  });

  it("skips users already locked/owned by another agent", async () => {
    // seed userA locked + active-assigned to a DIFFERENT agent.
    // seed our agent (cap 20) with a pool that includes userA + 19 others.
    // run cron → our agent's cohort excludes userA.
    const ourAgent = await prisma.agent.findFirstOrThrow({ where: { /* seeded ours */ } });
    const ours = await prisma.userAgentAssignment.findMany({
      where: { agentId: ourAgent.id, releasedAt: null },
      select: { externalUserId: true },
    });
    expect(ours.map((a) => a.externalUserId)).not.toContain(/* userA externalId */);
  });
});
```

- [ ] **Step 3: Fill in the harness specifics and run**

Replace the commented placeholders with the real builder calls + route invocation from Step 1. Run:
```bash
bun test tests/integration/cron-cohort-materialization.test.ts
```
Expected: 4 cases PASS. If "stops recruiting" fails, re-check Task 4 Step 2/3 lock clause; if "does not re-materialize" fails, re-check the `if (agent.cohortAssignedAt) continue;` guard.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/cron-cohort-materialization.test.ts
git commit -m "test(cron): cohort materialization — once, no re-materialize, no recruiting, skip-locked"
```

---

### Task 6: PATCH route — remove audienceCap; reset cohort on lock-release

PATCH currently releases `lockedByAgentId` when an agent is paused/drafted or its targeting changes (route.ts:130-136). For cohort agents this must ALSO release that agent's `UserAgentAssignment` rows and reset `cohortAssignedAt = null`, so the agent re-materializes a fresh cohort on the next active tick (otherwise its eligible query is cohort-only against zero locks → it does nothing).

**Files:**
- Modify: `src/app/api/agents/[id]/route.ts`
- Test: `tests/integration/agents-patch-audience-cap-removed.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/agents-patch-audience-cap-removed.test.ts` (adapt imports/auth to the existing `tests/integration/agents*` tests — note PATCH lives in the Next.js route, not the Hono service):

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
// import { PATCH } from "@/app/api/agents/[id]/route";  // match existing agents PATCH test imports
// import builders + an admin-session helper used by the existing PATCH tests

describe("PATCH /agents/[id] — audienceCap removed + cohort reset", () => {
  beforeEach(async () => { /* standard cleanup */ });

  it("ignores audienceCap in the body (no longer a field) and still applies other updates", async () => {
    // seed an agent. PATCH with { audienceCap: 100, dailySendCap: 250 }.
    // expect 200; agent.dailySendCap === 250; agent has no audienceCap property.
    const agent = await prisma.agent.findFirstOrThrow({ where: { /* seeded */ } });
    expect(agent.dailySendCap).toBe(250);
    expect((agent as Record<string, unknown>).audienceCap).toBeUndefined();
  });

  it("resets cohort (cohortAssignedAt=null + releases assignments + locks) when status → paused", async () => {
    // seed an agent with cohortAssignedAt set, 5 locked TrackedUsers, 5 active UserAgentAssignment.
    // PATCH { status: "paused" }.
    const agent = await prisma.agent.findFirstOrThrow({ where: { /* seeded */ } });
    expect(agent.cohortAssignedAt).toBeNull();
    const stillLocked = await prisma.trackedUser.count({ where: { lockedByAgentId: agent.id } });
    expect(stillLocked).toBe(0);
    const stillActive = await prisma.userAgentAssignment.count({ where: { agentId: agent.id, releasedAt: null } });
    expect(stillActive).toBe(0);
  });

  it("resets cohort when funnelStage changes", async () => {
    // seed materialized agent (cohortAssignedAt set, locks + assignments). PATCH { funnelStage: "mau" }.
    const agent = await prisma.agent.findFirstOrThrow({ where: { /* seeded */ } });
    expect(agent.cohortAssignedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/integration/agents-patch-audience-cap-removed.test.ts`
Expected: FAIL (cohort not reset; audienceCap still in update).

- [ ] **Step 3: Remove audienceCap validation**

In `src/app/api/agents/[id]/route.ts`, delete the validation block (lines 69-73):
```typescript
    if (body.audienceCap !== undefined) {
      if (body.audienceCap !== null && (!Number.isInteger(body.audienceCap) || body.audienceCap < 1)) {
        return fail("audienceCap must be null or a positive integer", 400);
      }
    }
```

- [ ] **Step 4: Remove audienceCap from the update + add cohort reset**

Delete the update spread (line 149):
```typescript
        ...(body.audienceCap !== undefined ? { audienceCap: body.audienceCap } : {}),
```

Then change the lock-release block (lines 130-136) to also release assignments and reset the cohort marker. Replace:
```typescript
    // Release user locks when agent is stopped, paused, or targeting criteria change
    if (body.status === "paused" || body.status === "draft" || body.targetSegmentName !== undefined || body.funnelStage !== undefined || body.segmentTargeting !== undefined) {
      await prisma.trackedUser.updateMany({
        where: { lockedByAgentId: id },
        data:  { lockedByAgentId: null },
      });
    }
```
with:
```typescript
    // Release user locks when agent is stopped, paused, or targeting criteria change.
    // The cohort is tied to those locks, so also release this agent's active
    // assignments and clear cohortAssignedAt → it re-materializes a fresh cohort
    // on the next active cron tick.
    const releasesCohort =
      body.status === "paused" ||
      body.status === "draft" ||
      body.targetSegmentName !== undefined ||
      body.funnelStage !== undefined ||
      body.segmentTargeting !== undefined;
    if (releasesCohort) {
      await prisma.trackedUser.updateMany({
        where: { lockedByAgentId: id },
        data:  { lockedByAgentId: null },
      });
      await prisma.userAgentAssignment.updateMany({
        where: { agentId: id, releasedAt: null },
        data:  { releasedAt: new Date(), releaseReason: "manual" },
      });
    }
```

Then add `cohortAssignedAt` reset to the `agent.update` data block (alongside the other conditional spreads, after line 159):
```typescript
        ...(releasesCohort ? { cohortAssignedAt: null } : {}),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/integration/agents-patch-audience-cap-removed.test.ts`
Expected: 3 cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agents/[id]/route.ts tests/integration/agents-patch-audience-cap-removed.test.ts
git commit -m "feat(api/agents): drop audienceCap from PATCH; reset cohort when locks release"
```

---

### Task 7: Remove the "Per-run rollout limit" UI + trace script reference

**Files:**
- Delete: `src/components/agents/audience-cap-editor.tsx`
- Modify: `src/app/agents/[id]/page.tsx` (remove `<AudienceCapEditor>` render + its import, ~lines 425-432)
- Modify: `scripts/trace-agent-send-gates.ts` (remove audienceCap log lines)

- [ ] **Step 1: Remove the render + import from the detail page**

In `src/app/agents/[id]/page.tsx`, delete the `<AudienceCapEditor ... />` block (~lines 425-432) and the `import { AudienceCapEditor } from "@/components/agents/audience-cap-editor";` line. If the card was wrapped in a layout cell/heading exclusively for it, remove that wrapper too so no empty card renders.

- [ ] **Step 2: Delete the component file**

Run: `git rm src/components/agents/audience-cap-editor.tsx`

- [ ] **Step 3: Clean the trace script**

In `scripts/trace-agent-send-gates.ts`, remove the lines that read/log `audienceCap` (Explore found refs around lines ~60-65 and ~130). Grep to confirm: `grep -n "audienceCap" scripts/trace-agent-send-gates.ts` → no matches.

- [ ] **Step 4: Repo-wide audienceCap sweep (non-generated)**

Run:
```bash
grep -rn "audienceCap" src apps tests scripts --include=*.ts --include=*.tsx
```
Expected: no matches outside `src/generated`/`apps/api/src/generated` (regenerated in Task 9). Fix any stragglers.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ui): remove Per-run rollout limit (audienceCap) editor + trace refs"
```

---

### Task 8: Card — show "Assigned: N" distinct from reach

The card today shows `uniqueUsers / uniqueUsersCap` where `uniqueUsers = COUNT(DISTINCT UserDecision.userId)` (actual reach). Add a separate **Assigned** count = active `UserAgentAssignment` rows per agent, so cap is not confused with reach (acceptance criterion #3).

**Files:**
- Modify: `src/lib/cache/agents.ts` (`getCachedAgentCardStats`, ~lines 139-173)
- Modify: `src/components/agents/agent-card.tsx` (~lines 28-47)
- Test: regression in `tests/regression/` for the new SQL column names

- [ ] **Step 1: Write the failing regression test for the SQL shape**

Per CLAUDE.md, every new `$queryRaw` gets a regression test verifying exact column names. Create `tests/regression/agent-card-assigned-count.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";

describe("agent card assigned-count query", () => {
  beforeEach(async () => { /* standard cleanup */ });

  it("counts active (releasedAt IS NULL) assignments per agent", async () => {
    // seed an agent; 3 active UserAgentAssignment + 1 released (releasedAt set) for it.
    const rows = await prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
      SELECT "agentId", COUNT(*)::bigint AS cnt
      FROM "UserAgentAssignment"
      WHERE "releasedAt" IS NULL
      GROUP BY "agentId"
    `;
    const mine = rows.find((r) => r.agentId === /* seeded agent id */ "");
    expect(Number(mine?.cnt)).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/regression/agent-card-assigned-count.test.ts`
Expected: FAIL until seeding is filled in (fill in the seeded agent id/rows using builders), then it asserts the real query shape.

- [ ] **Step 3: Add the assigned-count query to card stats**

In `src/lib/cache/agents.ts`, inside `getCachedAgentCardStats`, add a third query to the existing `Promise.all` and surface it in the return. After the `pushRows` query add:
```typescript
      prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
        SELECT "agentId", COUNT(*)::bigint AS cnt
        FROM "UserAgentAssignment"
        WHERE "releasedAt" IS NULL
        GROUP BY "agentId"
      `,
```
Bind it (e.g. `assignedRows`) and add to the returned object:
```typescript
      assigned: assignedRows.map((r) => ({ agentId: r.agentId, count: Number(r.cnt) })),
```
Keep the existing `uniqueUsers` (reach) field unchanged.

- [ ] **Step 4: Thread the assigned count to the card and render it**

Wherever `getCachedAgentCardStats()` is consumed to build per-agent props (the agents list page / card mapper), look up `assigned` by `agentId` and pass `assigned={count}` into `AgentCard`. In `src/components/agents/agent-card.tsx`, render it near the existing unique-users cell, e.g.:
```tsx
<div className="text-xs text-muted-foreground">
  Assigned: {assigned.toLocaleString()} / {uniqueUsersCap ? uniqueUsersCap.toLocaleString() : "∞"}
</div>
```
Keep the existing reach display (rename its label to "Reached" if it currently reads ambiguously as "Unique users", so Assigned vs Reached read distinctly). Add the `assigned: number` prop to the card's prop type.

- [ ] **Step 5: Run the regression test + typecheck**

Run: `bun test tests/regression/agent-card-assigned-count.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cache/agents.ts src/components/agents/agent-card.tsx tests/regression/agent-card-assigned-count.test.ts src/app/agents
git commit -m "feat(card): show Assigned (active cohort) distinct from Reached"
```

---

### Task 9: Drop the `audienceCap` column + final verification

All code references are gone (Tasks 4, 6, 7). Now remove the field from the schema and drop the column on the local DB; regenerate both clients.

**Files:**
- Modify: `prisma/schema.prisma:27` (remove `audienceCap` line)
- Create: `prisma/migrations/<timestamp>_drop_audience_cap/migration.sql`

- [ ] **Step 1: Remove the field from the schema**

In `prisma/schema.prisma`, delete line 27:
```prisma
  audienceCap      Int?        // max users reached per cron run; null = unlimited
```

- [ ] **Step 2: Write the idempotent drop migration**

Create `prisma/migrations/<timestamp>_drop_audience_cap/migration.sql`:
```sql
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "audienceCap";
```

- [ ] **Step 3: Apply to local test DB**

Run:
```bash
psql -d nexus_test -c 'ALTER TABLE "Agent" DROP COLUMN IF EXISTS "audienceCap";'
```
Expected: `ALTER TABLE`.

- [ ] **Step 4: Regenerate both clients**

Run:
```bash
npx prisma generate && (cd apps/api && bun run generate)
```
Expected: both regenerate; `audienceCap` no longer on the Agent type.

- [ ] **Step 5: Full check**

Run: `bun run check`
Expected: typecheck + lint + full integration + regression all PASS. (This is the gate before the MR; it exercises the cron + PATCH + card paths against the local DB.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated apps/api/src/generated
git commit -m "feat(schema): drop Agent.audienceCap column"
```

> **Deploy note (do NOT run here):** Prod application is `ALTER TABLE "Agent" DROP COLUMN IF EXISTS "audienceCap";` + `npx prisma migrate resolve --applied <both migration names>`. Run the ADD (Task 1) and code deploy BEFORE the DROP so a brief version skew never reads a missing column. Ordering: deploy code (no longer references audienceCap) → drop column.

---

## Rollout / ops notes (for the human, post-merge)

- On first prod cron tick after deploy, **every active agent** with `uniqueUsersCap` set and `cohortAssignedAt = null` materializes a cohort (locks up to N users, stops recruiting). Neo/Morpheus included — this is the intended fix for their trickle. Watch the first run's logs/metrics: assignment counts should jump to ~`uniqueUsersCap` per active agent, then sends ramp under `dailySendCap`.
- Agents with `uniqueUsersCap = null` (unlimited) keep recruiting every run (no cohort), now bounded by `dailySendCap×2` / `MAX_FETCH_LIMIT` instead of `audienceCap`.
- To re-cut a cohort for an existing agent: pause→reactivate, or change its targeting (either resets `cohortAssignedAt`).

---

## Self-Review

**Spec coverage (vs handoff doc Option A + acceptance criteria):**
- AC1 "N distinct users linked within T" → Tasks 4 + 5 (materialize on next tick, ≤1hr). ✅
- AC2 ">0 sends within 24h, not capped to 100/hr" → Task 4 removes audienceCap; cohort processed every run under dailySendCap. ✅
- AC3 "UI shows Assigned vs Reached separate from cap" → Task 8. ✅
- AC4 "two agents can't silently steal each other's cohort" → Task 4 reuses fleet-exclusivity + null-guarded lock; Task 5 "skip-locked" test. ✅
- AC5 "POST cap:50 → 50 assignments; cron processes them before random lottery" → Materialization runs before `buildAgentLottery` (Task 4 Step 4); Task 5 asserts exact count. ✅ (Note: assignment is on next tick, not synchronously in POST — per decision #1; this refines AC5's wording.)
- "Drop audienceCap card" → Tasks 2,4,6,7,9. ✅
- Decisions #1-#5 → materialization on tick (Task 4), skip-locked (Task 4/5), random sample (Task 3), exploration unchanged (no task touches exploration-window.ts), existing agents auto-materialize (no backfill in Task 1; rollout note). ✅

**Placeholder scan:** Test files in Tasks 5/6 contain intentionally-commented seeding placeholders because the exact builder/auth/Braze-mock harness must be copied from the existing cron + agents tests (Step 1 of each instructs reading them first); the assertions are concrete. All implementation steps show complete code.

**Type consistency:** `resolveFetchLimit(dailySendCap, uniqueUsersCap)` used consistently (Task 2 def, Task 4 call). `partitionByPreferredHour` returns `{ kept, deferred }` (Task 2) and Task 4 reads `.kept`. `selectCohort(eligible, cap, random?)` def (Task 3) matches call (Task 4). `cohortAssignedAt` field name consistent across Tasks 1,4,6,9. Card `assigned` field consistent Task 8.
