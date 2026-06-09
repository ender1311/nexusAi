# Trigger-Based Enrollment + Interaction-Flag Conversions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (1) a per-agent **enrollment mode** selector (`fixed` frozen-cohort vs `continuous` open-enrollment with segment-exit), and (2) **interaction-flag conversions** that let an agent's goals target the ~9 `*_has_ever_flag` user attributes, with two per-goal categories: *first-interaction-only* and *any-interaction*.

**Architecture:** Both features extend the existing cohort/cron + goal/attribution machinery rather than replacing it. Enrollment mode adds a column to `Agent`, a re-evaluation pass in the `select-and-send` cron, and a new `segment_exit` release reason. Interaction-flag conversions add a `conversionType` column to `Goal`, a canonical flag-list constant, a baseline snapshot captured on `UserAgentAssignment` at enrollment, and a transition detector wired into `/api/ingest/users` that credits conversions through the existing `applyConversion` path.

**Tech stack:** Next.js 16 App Router, React 19, Prisma v7 + Postgres (Neon prod), Hono backend service in `apps/api/`, bun test. Agent writes go through the app→backend proxy (`src/app/api/agents/route.ts` → `apps/api/src/routes/agents.ts`).

---

## Design Context (read before any task)

### Current state — enrollment / cohort

- `Agent` (prisma/schema.prisma:15–52) has `uniqueUsersCap Int?` (default 1000 — set in `apps/api/src/routes/agents.ts:192`), `dailySendCap Int?`, and `cohortAssignedAt DateTime?`.
- **Cohort freeze** happens once, on the first cron tick after an agent is active, in `src/app/api/cron/select-and-send/route.ts:416–445`:
  - skips agents that already have `cohortAssignedAt` (line 417),
  - skips agents with `uniqueUsersCap == null` — "unlimited agents never materialize" (line 418),
  - otherwise `selectCohort(pool, cap)`, race-safe-locks users via `trackedUser.updateMany({ lockedByAgentId: null } → agent.id)`, creates `UserAgentAssignment` rows, and stamps `cohortAssignedAt = now`.
- **`UserAgentAssignment`** (schema) has `externalUserId String @unique` — a user is owned by at most one agent at a time. `releasedAt`/`releaseReason` track release; `releaseReason` set is `conversion | cohort_exit | hold_cap_days | hold_cap_sends | manual`.
- **Release logic** is the pure `classifyReleases` in `src/lib/cron/release-sweep.ts`. Today the only segment/stage-driven exit is `cohort_exit`, and only for **funnel-stage** agents (`agent.targetStages.size > 0`). Segment-targeted agents pass an empty `targetStages` set, so they currently **never** exit on audience change (release-sweep.ts:44; select-and-send wires the empty set).

So: a segment-targeted agent with the default cap freezes a one-time cohort and only releases users via hold caps (90d / 24 sends) or conversion. That is the "Morpheus/Neo/Artemis" pattern the user described.

### Decision: enrollment mode = **Fixed vs Continuous** (user-confirmed)

Add `Agent.enrollmentMode String @default("fixed")` with two values:

- **`fixed`** — today's behavior, unchanged. Cohort freezes at `uniqueUsersCap`; users leave only via hold caps / conversion. This stays the default so existing agents are untouched.
- **`continuous`** — open enrollment. The cron **re-evaluates segment membership every run**:
  - **enroll** newly-matching users who aren't owned by any agent (create `UserAgentAssignment`, snapshot baseline flags — see below),
  - **release** owned users who have fallen out of the agent's audience (new `releaseReason = "segment_exit"`),
  - **no cohort freeze**: `cohortAssignedAt` is never stamped for continuous agents, and the cap (if any) acts as a *soft ceiling* on concurrently-owned users rather than a one-time lock.

### Current state — conversions / goals

- `Goal` (schema:54–68): `eventName`, `tier`, `valueWeight`, `weightMode`, `weightProperty`, `weightDefault`, `description`.
- Goal presets live in `src/lib/constants/youversion.ts` (`YOUVERSION_GOALS`); the wizard/goal-editor pick from them (`src/components/agents/goal-preset-picker.tsx`, `src/components/goals/goals-editor.tsx`).
- Conversion crediting: `/api/ingest/events` (Hightouch event stream) finds the most recent unconverted `UserDecision` in an attribution window and calls `applyConversion` (`src/lib/services/attribution-service.ts`), which computes reward via `calculateReward` (`src/lib/engine/reward-calculator.ts`), flips `conversionAt`, updates arm stats, and releases the owning assignment with `releaseReason "conversion"`.
- **The 9 interaction flags are synced as user attributes via `/api/ingest/users`** (stored verbatim in `TrackedUser.attributes` JSON) and, per the sync-contract test, *nothing reads them yet*. They are **not** events — they are boolean attributes that flip once (false/absent → true) when the user first does the thing.

Canonical list (from `tests/regression/ingest-users-preferred-channel-flag-fields.test.ts:18–28`):

```
guided_scripture_interaction_has_ever_flag
guided_prayer_interaction_has_ever_flag
plan_audio_interaction_has_ever_flag
plan_interaction_has_ever_flag
plan_subscribed_has_ever_flag
plan_day_completion_has_ever_flag
pmt_participation_has_ever_flag
votd_interaction_has_ever_flag
votd_share_has_ever_flag
```

### Decision: per-goal conversion category (user-confirmed)

Add `Goal.conversionType String?` (null for normal event goals). For interaction-flag goals it is one of:

- **`first_interaction`** (Type A) — credited only when the flag transitions false/absent → true **and** the flag was **false/absent at enrollment** (genuine first interaction during this agent's ownership). Measures activation of never-users.
- **`any_interaction`** (Type B) — credited when the flag is observed `true` during ownership, **regardless of the enrollment baseline**. For a user already `true` at enrollment, this credits on the first sync after enrollment (the outcome is already satisfied). Measures "did this user do X while owned," ignoring whether it was their first time.

An interaction-flag goal's `eventName` is the flag name itself (e.g. `plan_interaction_has_ever_flag`). One agent may freely mix Type-A and Type-B interaction goals plus ordinary event goals.

### Decision: Type-A baseline = **snapshot at enrollment** (user-confirmed)

Add `UserAgentAssignment.enrollmentFlags Json?` — a snapshot of the user's interaction-flag values (booleans, normalized) captured when the assignment row is created (both in the `fixed`-cohort materialization path and the `continuous` enrollment path). `first_interaction` crediting checks `enrollmentFlags[flag] !== true`.

### Conversion detection for flags — where it lives

Flags arrive through `/api/ingest/users`, not `/api/ingest/events`. So detection is a new step in the users-ingest path: after upserting a user, diff the incoming flag values against what was stored, and for each flag that is now `true`, credit any agent that currently **owns** the user (active `UserAgentAssignment`) and has a goal whose `eventName` is that flag. Reuse `applyConversion` by passing a synthetic decision (the user's most recent unconverted `UserDecision` for that agent) so reward/arm-stats/release all flow through the one audited path.

> **Important nuance for the implementer:** `applyConversion` requires a `UserDecision` to attribute to. If an owned user has no recent unconverted decision (e.g. interaction happened before any send), there is nothing to attribute the reward to. Treat "owned + goal matches + flag flipped + no attributable decision" as an *unmatched* conversion (log it in `IngestSyncLog` details, do not throw). Crediting reward requires a prior send — that is the intended behavior (we only reward interactions plausibly caused by a send).

### Scope guardrails (do NOT touch)

- Do **not** alter the `fixed`-cohort behavior or defaults. `enrollmentMode` defaults to `fixed`.
- Do **not** modify the meaning of `uniqueUsersCap` / `dailySendCap` for `fixed` agents.
- Migrations on prod are **additive only** (`ADD COLUMN ... IF NOT EXISTS`, nullable / defaulted). Never `prisma migrate dev` against prod. Follow CLAUDE.md DB rules and the idempotent-DDL + `migrate resolve --applied` pattern.
- `UserSegment` / `User` data is sacred — additive only.

### Test DB env prefix (integration/regression tests)

```
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT \
  PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 \
  DATABASE_URL="postgresql://localhost:5432/nexus_test" CRON_SECRET="test_cron_secret" \
  bun test <path>
```

Run `bun run check:quick` while iterating; `bun run check` before the MR. Ship via `glab` MR flow (commit → branch → push → `glab mr create` → poll mergeable + pipeline → `glab mr merge` → sync main). Direct-to-main is blocked.

---

## File Structure

**New files:**
- `src/lib/constants/interaction-flags.ts` — canonical flag list + helpers (single source of truth).
- `src/lib/services/interaction-conversion.ts` — pure transition-detection logic (which flags flipped, which goals/categories credit).
- `tests/unit/interaction-flags.test.ts`
- `tests/unit/interaction-conversion.test.ts`
- `tests/integration/continuous-enrollment.test.ts`
- `tests/integration/interaction-flag-conversion.test.ts`
- `tests/regression/enrollment-mode-default-fixed.test.ts`

**Modified files:**
- `prisma/schema.prisma` — `Agent.enrollmentMode`, `Goal.conversionType`, `UserAgentAssignment.enrollmentFlags`.
- `apps/api/src/routes/agents.ts` — validate + persist `enrollmentMode` and goal `conversionType`.
- `src/app/api/cron/select-and-send/route.ts` — continuous re-evaluation pass; skip freeze for continuous agents.
- `src/lib/cron/release-sweep.ts` — `segment_exit` release reason for continuous agents.
- `src/app/api/ingest/users/route.ts` — call the interaction-conversion detector after upsert.
- `src/lib/constants/youversion.ts` — interaction-flag goal presets.
- `src/components/agents/agent-wizard.tsx` — enrollment-mode selector; conversion-category control on interaction-flag goals.
- `src/types/agent.ts` — extend `Goal` / agent form types with new fields.

---

## Phase 1 — Schema & constants foundation

### Task 1: Add the canonical interaction-flag constant

**Files:**
- Create: `src/lib/constants/interaction-flags.ts`
- Test: `tests/unit/interaction-flags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/interaction-flags.test.ts
import { describe, expect, it } from "bun:test";
import { INTERACTION_FLAGS, isInteractionFlag, normalizeFlag } from "@/lib/constants/interaction-flags";

describe("interaction flags", () => {
  it("lists exactly the 9 has_ever flags", () => {
    expect(INTERACTION_FLAGS).toHaveLength(9);
    expect(INTERACTION_FLAGS).toContain("plan_interaction_has_ever_flag");
    expect(INTERACTION_FLAGS.every((f) => f.endsWith("_flag"))).toBe(true);
  });
  it("recognizes a flag name", () => {
    expect(isInteractionFlag("votd_share_has_ever_flag")).toBe(true);
    expect(isInteractionFlag("not_a_flag")).toBe(false);
  });
  it("normalizes truthy variants Hightouch may send", () => {
    expect(normalizeFlag(true)).toBe(true);
    expect(normalizeFlag("true")).toBe(true);
    expect(normalizeFlag(1)).toBe(true);
    expect(normalizeFlag(false)).toBe(false);
    expect(normalizeFlag("false")).toBe(false);
    expect(normalizeFlag(0)).toBe(false);
    expect(normalizeFlag(null)).toBe(false);
    expect(normalizeFlag(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module`).

Run: `bun test tests/unit/interaction-flags.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/constants/interaction-flags.ts
// Canonical list of Hightouch-synced "has ever interacted" boolean flags.
// Pinned by tests/regression/ingest-users-preferred-channel-flag-fields.test.ts.
export const INTERACTION_FLAGS = [
  "guided_scripture_interaction_has_ever_flag",
  "guided_prayer_interaction_has_ever_flag",
  "plan_audio_interaction_has_ever_flag",
  "plan_interaction_has_ever_flag",
  "plan_subscribed_has_ever_flag",
  "plan_day_completion_has_ever_flag",
  "pmt_participation_has_ever_flag",
  "votd_interaction_has_ever_flag",
  "votd_share_has_ever_flag",
] as const;

export type InteractionFlag = (typeof INTERACTION_FLAGS)[number];

const FLAG_SET = new Set<string>(INTERACTION_FLAGS);
export function isInteractionFlag(id: string): id is InteractionFlag {
  return FLAG_SET.has(id);
}

// Hightouch may send bool, "true"/"false" string, or 0/1 depending on the
// warehouse column type — normalize the same way channel-preference.ts does.
export function normalizeFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "t";
  }
  return false;
}

export const INTERACTION_FLAG_LABELS: Record<InteractionFlag, string> = {
  guided_scripture_interaction_has_ever_flag: "Guided Scripture (first interaction)",
  guided_prayer_interaction_has_ever_flag: "Guided Prayer (first interaction)",
  plan_audio_interaction_has_ever_flag: "Plan Audio (first interaction)",
  plan_interaction_has_ever_flag: "Plan (first interaction)",
  plan_subscribed_has_ever_flag: "Plan Subscribed (first time)",
  plan_day_completion_has_ever_flag: "Plan Day Completed (first time)",
  pmt_participation_has_ever_flag: "PMT Participation (first time)",
  votd_interaction_has_ever_flag: "Verse of the Day (first interaction)",
  votd_share_has_ever_flag: "Verse of the Day Share (first time)",
};
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(constants): canonical interaction-flag list + normalizer`.

---

### Task 2: Schema columns (additive migration)

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/regression/enrollment-mode-default-fixed.test.ts`

- [ ] **Step 1: Write the failing regression test** (pins defaults + that existing agents stay `fixed`).

```ts
// tests/regression/enrollment-mode-default-fixed.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("enrollmentMode default", () => {
  it("defaults to 'fixed' so existing agents are unaffected", async () => {
    const a = await createAgent({ name: "Legacy" });
    const row = await prisma.agent.findUnique({ where: { id: a.id } });
    expect(row?.enrollmentMode).toBe("fixed");
  });
});
```

> If `createAgent` doesn't exist in `tests/helpers/builders.ts`, use the existing factory used by other agent tests; check `tests/helpers/builders.ts` first.

- [ ] **Step 2: Run — expect FAIL** (`enrollmentMode` unknown).

- [ ] **Step 3: Edit `prisma/schema.prisma`.**

In `model Agent` (after `cohortAssignedAt`, ~line 29):
```prisma
  enrollmentMode   String      @default("fixed") // "fixed" = frozen cohort; "continuous" = open enrollment + segment_exit
```
In `model Goal` (after `description`, ~line 63):
```prisma
  conversionType String?   // null = normal event goal; "first_interaction" | "any_interaction" for *_has_ever_flag goals
```
In `model UserAgentAssignment` (after `releaseReason`):
```prisma
  enrollmentFlags Json?     // snapshot of normalized interaction-flag values at enrollment (for first_interaction crediting)
```

- [ ] **Step 4: Regenerate client + apply to BOTH local test DB and (later, in the ship step) prod via idempotent DDL.** For the local test DB, apply directly:

```bash
npx prisma generate
psql "postgresql://localhost:5432/nexus_test" -v ON_ERROR_STOP=1 \
  -c 'ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "enrollmentMode" TEXT NOT NULL DEFAULT '"'"'fixed'"'"';' \
  -c 'ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "conversionType" TEXT;' \
  -c 'ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "enrollmentFlags" JSONB;'
```
Mirror the same DDL on `apps/api` generated client: `cd apps/api && npx prisma generate` (the backend has its own generated client).

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit** — `feat(schema): enrollmentMode, goal conversionType, assignment enrollmentFlags`.

> **Prod DDL is part of the final ship step (Task 11), not now.** Use `ADD COLUMN IF NOT EXISTS` on prod against `DATABASE_URL_UNPOOLED`, create the migration folder, and `prisma migrate resolve --applied` — never `migrate dev`.

---

## Phase 2 — Backend validation & persistence

### Task 3: Validate + persist `enrollmentMode` and goal `conversionType` (backend)

**Files:**
- Modify: `apps/api/src/routes/agents.ts`
- Test: `tests/integration/agents.test.ts` (add cases)

- [ ] **Step 1: Write failing integration tests** asserting:
  - POST `/agents` with `enrollmentMode: "continuous"` persists it; default is `"fixed"`; invalid value → 400.
  - POST a goal with `conversionType: "first_interaction"` and `eventName: "plan_interaction_has_ever_flag"` persists; an invalid `conversionType` → 400; a `conversionType` set on a non-flag `eventName` → 400 ("conversionType only valid for interaction-flag goals").

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement validation in `apps/api/src/routes/agents.ts`.**

After the existing destructure (line 49–71) add `enrollmentMode` to the pulled fields. After the caps validation (~line 119) add:
```ts
const VALID_ENROLLMENT = new Set(["fixed", "continuous"]);
if (enrollmentMode !== undefined && enrollmentMode !== null) {
  if (typeof enrollmentMode !== "string" || !VALID_ENROLLMENT.has(enrollmentMode)) {
    return c.json({ error: "enrollmentMode must be 'fixed' or 'continuous'" }, 400);
  }
}
```
In the goals validation loop (line 140–147) add:
```ts
const VALID_CONV_TYPE = new Set(["first_interaction", "any_interaction"]);
const FLAG_NAMES = new Set(INTERACTION_FLAGS); // import from a backend copy of the constant (see note)
if (g.conversionType !== undefined && g.conversionType !== null) {
  if (typeof g.conversionType !== "string" || !VALID_CONV_TYPE.has(g.conversionType)) {
    return c.json({ error: "goal.conversionType must be 'first_interaction' or 'any_interaction'" }, 400);
  }
  if (!FLAG_NAMES.has((g.eventName as string).trim())) {
    return c.json({ error: "conversionType is only valid for *_has_ever_flag goals" }, 400);
  }
}
```
In `prisma.agent.create` (line 184) add `enrollmentMode: typeof enrollmentMode === "string" ? enrollmentMode : undefined,` and in the goals `create` map (line 210–218) add `conversionType: typeof g.conversionType === "string" ? g.conversionType : null,`.

> **Note on the constant:** `apps/api/` has its own source tree and cannot import from `src/`. Add a small `apps/api/src/lib/interaction-flags.ts` mirroring the `INTERACTION_FLAGS` array (the list is pinned by a regression test, so drift is caught). Reference the contract-parity memory: API-service validators must not silently diverge — pin both with the same regression list.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Verify the proxy passes the fields through.** `src/app/api/agents/route.ts` forwards the whole body, so no change needed — but add a one-line assertion test that the proxy includes `enrollmentMode` in the forwarded payload if the existing proxy tests stub `apiFetch`.
- [ ] **Step 6: Commit** — `feat(api/agents): validate+persist enrollmentMode and goal conversionType`.

---

## Phase 3 — Interaction-flag conversion detection (pure core)

### Task 4: Pure transition detector

**Files:**
- Create: `src/lib/services/interaction-conversion.ts`
- Test: `tests/unit/interaction-conversion.test.ts`

This is a **pure** function (no DB) per the engine/service purity convention: given the incoming attributes, the previously-stored attributes, the enrollment baseline snapshot, and the owning agent's goals, return which goals should be credited.

- [ ] **Step 1: Write failing test.**

```ts
// tests/unit/interaction-conversion.test.ts
import { describe, expect, it } from "bun:test";
import { detectFlagConversions } from "@/lib/services/interaction-conversion";

const goal = (eventName: string, conversionType: string) =>
  ({ eventName, conversionType } as { eventName: string; conversionType: string | null });

describe("detectFlagConversions", () => {
  it("Type A credits a genuine first interaction (baseline false → now true)", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: { plan_interaction_has_ever_flag: false },
      enrollmentFlags: { plan_interaction_has_ever_flag: false },
      goals: [goal("plan_interaction_has_ever_flag", "first_interaction")],
    });
    expect(out).toEqual(["plan_interaction_has_ever_flag"]);
  });

  it("Type A does NOT credit when the user was already interacted at enrollment", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: { plan_interaction_has_ever_flag: false },
      enrollmentFlags: { plan_interaction_has_ever_flag: true }, // already true at enroll
      goals: [goal("plan_interaction_has_ever_flag", "first_interaction")],
    });
    expect(out).toEqual([]);
  });

  it("Type B credits when the flag is true during ownership regardless of baseline", () => {
    const out = detectFlagConversions({
      incoming: { votd_share_has_ever_flag: true },
      stored: { votd_share_has_ever_flag: true },         // already true, no transition
      enrollmentFlags: { votd_share_has_ever_flag: true },
      goals: [goal("votd_share_has_ever_flag", "any_interaction")],
    });
    expect(out).toEqual(["votd_share_has_ever_flag"]);
  });

  it("does not credit a flag the agent has no goal for", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: { plan_interaction_has_ever_flag: false },
      enrollmentFlags: { plan_interaction_has_ever_flag: false },
      goals: [goal("votd_share_has_ever_flag", "first_interaction")],
    });
    expect(out).toEqual([]);
  });

  it("ignores normal event goals (conversionType null)", () => {
    const out = detectFlagConversions({
      incoming: { plan_interaction_has_ever_flag: true },
      stored: {},
      enrollmentFlags: {},
      goals: [goal("plan_interaction_has_ever_flag", null)],
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**

```ts
// src/lib/services/interaction-conversion.ts
import { isInteractionFlag, normalizeFlag } from "@/lib/constants/interaction-flags";

type FlagGoal = { eventName: string; conversionType: string | null };

/**
 * Pure: decide which interaction-flag goals to credit on a user sync.
 * - first_interaction (Type A): flag is now true AND was false/absent at enrollment.
 * - any_interaction  (Type B): flag is now true (baseline irrelevant).
 * Returns the list of flag eventNames to credit (deduped, only those the agent
 * actually has a matching goal for).
 */
export function detectFlagConversions(args: {
  incoming: Record<string, unknown>;
  stored: Record<string, unknown>;
  enrollmentFlags: Record<string, unknown>;
  goals: FlagGoal[];
}): string[] {
  const { incoming, enrollmentFlags, goals } = args;
  const credited = new Set<string>();
  for (const g of goals) {
    if (!g.conversionType) continue;
    if (!isInteractionFlag(g.eventName)) continue;
    const nowTrue = normalizeFlag(incoming[g.eventName]);
    if (!nowTrue) continue;
    if (g.conversionType === "first_interaction") {
      const baseTrue = normalizeFlag(enrollmentFlags[g.eventName]);
      if (baseTrue) continue; // already interacted before enrollment — not a first interaction
    }
    credited.add(g.eventName);
  }
  return [...credited];
}
```

> `stored` is in the signature for symmetry/future use (e.g. only crediting on the actual transition) but Type B intentionally ignores it. Keep it; the integration layer may use it to avoid re-crediting (idempotency is enforced at the decision level by `applyConversion`'s `conversionAt: null` guard).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(conversions): pure interaction-flag conversion detector`.

---

## Phase 4 — Wire detection into user ingest

### Task 5: Capture enrollment baseline + credit flag conversions on user sync

**Files:**
- Modify: `src/app/api/ingest/users/route.ts`
- Modify: `src/lib/services/attribution-service.ts` (only if a thin helper is needed to attribute a flag conversion to the owning agent)
- Test: `tests/integration/interaction-flag-conversion.test.ts`

- [ ] **Step 1: Write failing integration test.**

Seed: an agent with a `first_interaction` goal on `plan_interaction_has_ever_flag`; a user owned by that agent (active `UserAgentAssignment` with `enrollmentFlags: { plan_interaction_has_ever_flag: false }`) who has a recent unconverted `UserDecision` from that agent. POST `/api/ingest/users` with `plan_interaction_has_ever_flag: true`. Assert the decision's `conversionAt` is now set and `conversionEvent === "plan_interaction_has_ever_flag"`. Add a second case: a user whose `enrollmentFlags` already had the flag true → decision stays unconverted (Type A not credited).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** in `src/app/api/ingest/users/route.ts`, after the user upsert, for each synced user:
  1. read prior stored attributes (already available pre-upsert, or re-read),
  2. find the active owning assignment: `userAgentAssignment.findFirst({ where: { externalUserId, releasedAt: null } })`,
  3. if owned, load that agent's goals, run `detectFlagConversions({ incoming, stored, enrollmentFlags: assignment.enrollmentFlags ?? {}, goals })`,
  4. for each credited flag, find the most recent unconverted `UserDecision` for `(userId, agentId)`; if found, call `applyConversion({ decision, conversionEvent: flag, occurredAt: now, properties: {} })`; if none found, push to an `unmatched` tally for the `IngestSyncLog`.

Keep the work batched and failure-isolated (one user's failure must not abort the sync) — mirror the try/catch + `IngestSyncLog` pattern already in `/api/ingest/events`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** Add `reward-calculator` coverage: a flag `eventName` with a configured `tier` flows through `calculateReward` unchanged (it's just a tier×weight event — no special-casing needed). Add a unit test in `tests/unit/engine/` confirming `calculateReward("plan_interaction_has_ever_flag", [{eventName, tier:"very_good", valueWeight:7,...}])` returns the expected normalized reward.
- [ ] **Step 6: Commit** — `feat(ingest/users): credit interaction-flag conversions for owning agents`.

---

## Phase 5 — Continuous enrollment in the cron

### Task 6: `segment_exit` release reason (pure)

**Files:**
- Modify: `src/lib/cron/release-sweep.ts`
- Test: `tests/unit/release-sweep.test.ts` (add cases)

- [ ] **Step 1: Write failing test.** Extend `ReleaseAgentInfo` with `enrollmentMode: "fixed" | "continuous"` and an `inAudience: (externalUserId) => boolean` decision passed in by the orchestrator (or pass a precomputed `Set<string>` of currently-in-audience user ids per agent — preferred, matches the existing `targetStages: Set` style). For a `continuous` agent, a user whose id is **not** in the agent's current audience set is released with reason `"segment_exit"`. For `fixed` agents, behavior is unchanged.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Add `"segment_exit"` to the `ReleaseReason` union. Add to `ReleaseAgentInfo`:
```ts
  enrollmentMode: "fixed" | "continuous";
  audience?: Set<string>; // only for continuous agents: ids currently matching the segment
```
In `classifyReleases`, before the `cohort_exit` check:
```ts
if (agent.enrollmentMode === "continuous" && agent.audience && !agent.audience.has(a.externalUserId)) {
  out.push({ id: a.id, externalUserId: a.externalUserId, reason: "segment_exit" });
  continue;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(release-sweep): segment_exit for continuous-enrollment agents`.

---

### Task 7: Continuous enrollment pass in select-and-send

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`
- Test: `tests/integration/continuous-enrollment.test.ts`

- [ ] **Step 1: Write failing integration test.** Create a `continuous` agent targeting a segment. Tick the cron with users A,B in the segment → both get `UserAgentAssignment` (releasedAt null), `enrollmentFlags` snapshot present, and `agent.cohortAssignedAt` stays **null**. Move user B out of the segment, add user C; tick again → B released with `releaseReason "segment_exit"`, C newly enrolled, A still owned. Assert no cohort freeze ever happened.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** In the cohort-materialization loop (lines 416–445):
  - **Skip freeze for continuous agents:** `if (agent.enrollmentMode === "continuous") continue;` at the top of the loop (so `cohortAssignedAt` is never stamped and the existing freeze path is untouched).
  - **Add a new continuous-enrollment pass** (separate loop, after materialization) that, for each `continuous` agent:
    - computes the current eligible/in-audience set (`eligibleUsersByAgent` already holds this per agent),
    - enrolls users in the audience not already owned by any agent: `trackedUser.updateMany({ where: { externalId in audience, lockedByAgentId: null }, data: { lockedByAgentId: agent.id }})` then `userAgentAssignment.createMany` with `enrollmentFlags` = the user's normalized interaction-flag snapshot (read flags from the already-loaded user attributes; build with `INTERACTION_FLAGS.reduce(...)`),
    - respects `uniqueUsersCap` as a soft ceiling: count current active assignments for the agent and only enroll up to the remaining headroom.
  - **Release on exit** is handled by the existing release-sweep phase (Task 6) — make sure the orchestrator now passes `enrollmentMode` + the per-agent `audience` set into `ReleaseAgentInfo`. Find where `classifyReleases` is called in this route and extend the `agentsById` construction.

> Read lines ~200–260 and wherever `classifyReleases` / release-sweep is invoked before editing; the orchestrator already builds `ReleaseAgentInfo` with `targetStages`, so add the two new fields there.

- [ ] **Step 4: Run — expect PASS.** Also run the existing `tests/integration` cohort tests to confirm `fixed` agents are unchanged.
- [ ] **Step 5: Commit** — `feat(cron): continuous open-enrollment + segment_exit for continuous agents`.

---

## Phase 6 — UI

### Task 8: Enrollment-mode selector in the agent wizard

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`
- Modify: `src/types/agent.ts` (form types)
- Test: `tests/unit/` component test for the wizard step (follow existing wizard test patterns; check for an existing `agent-wizard` test first)

- [ ] **Step 1:** Read `src/components/agents/agent-wizard.tsx` around the Targeting Mode block (lines ~529–588) and the `FormData` type (~205–227) and `handleSubmit` (~361–399).
- [ ] **Step 2: Write failing test** asserting the wizard renders an "Enrollment" control with two options and includes `enrollmentMode` in the submitted payload (default `"fixed"`).
- [ ] **Step 3: Implement.** Add `enrollmentMode: "fixed" | "continuous"` to `FormData` (default `"fixed"`); render a two-option selector (radio/segmented control) in Step 1 just below Targeting Mode, with helper copy:
  - **Fixed cohort** — "Locks a one-time group of up to your user cap. Users stay until they convert or hit hold limits. Best for one-off campaigns."
  - **Continuous (trigger-based)** — "Re-checks the segment every run: adds new matches and removes users who leave the segment. Best for always-on, behavior-triggered comms." (When selected, visually de-emphasize the unique-users cap as a soft ceiling.)
  Include `enrollmentMode` in the `handleSubmit` payload.
- [ ] **Step 4: Run — expect PASS.** Manually run `bun run dev` and click through `/agents/new` to confirm the control renders and submits.
- [ ] **Step 5: Commit** — `feat(ui): enrollment-mode selector in agent wizard`.

---

### Task 9: Interaction-flag goals + conversion-category control

**Files:**
- Modify: `src/lib/constants/youversion.ts` (add interaction-flag presets)
- Modify: `src/components/agents/goal-preset-picker.tsx` and/or `src/components/goals/goals-editor.tsx`
- Modify: `src/types/agent.ts` (`Goal` gets optional `conversionType`)
- Test: component test + a constants test

- [ ] **Step 1: Write failing tests.** (a) a constants test that interaction-flag presets exist for all 9 flags; (b) a goal-editor test that selecting an interaction-flag goal exposes a "Conversion type" toggle (First interaction / Any interaction) and that the chosen value is included when goals are saved.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
  - Add an `INTERACTION_GOALS: YouVersionGoalPreset[]` export in `youversion.ts` built from `INTERACTION_FLAGS` + `INTERACTION_FLAG_LABELS` (tier e.g. `"very_good"`, weight tunable per flag — default 5). Surface them as a third group ("Feature activation") in the preset picker.
  - Extend the `Goal` form type with `conversionType?: "first_interaction" | "any_interaction"`. When a goal's `eventName` is an interaction flag, render a small segmented toggle (default `first_interaction`); otherwise hide it. Include `conversionType` in the goals PUT/POST payload.
- [ ] **Step 4: Run — expect PASS.** Manual dev-server check on `/agents/[id]/goals` and the wizard goal step.
- [ ] **Step 5: Commit** — `feat(ui): interaction-flag goal presets + conversion-category toggle`.

---

## Phase 7 — Full verify & ship

### Task 10: Full suite + manual QA

- [ ] `bun run check` (typecheck + lint + full integration + regression). Fix anything red.
- [ ] Manual: create one `continuous` agent with a `first_interaction` goal and one `fixed` agent; confirm in dev that a fixed agent still freezes and a continuous agent re-evaluates across two cron ticks (you can invoke the cron route directly with the test `CRON_SECRET`).

### Task 11: Ship (MR flow) + prod DDL

- [ ] Commit any remaining changes; push branch; `glab mr create`.
- [ ] **Apply additive prod DDL** against `DATABASE_URL_UNPOOLED` (from `.env.local`), idempotently:
```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "enrollmentMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "conversionType" TEXT;
ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "enrollmentFlags" JSONB;
```
  Then create the Prisma migration folder and `npx prisma migrate resolve --applied <migration>` so history matches without re-running DDL (see the "migration created not applied to prod" memory). Do the same generate step for `apps/api`.
- [ ] Poll `detailed_merge_status=mergeable` + pipeline success; `glab mr merge`; sync main.
- [ ] Post-deploy: watch the first cron tick. Continuous agents will begin enrolling/releasing immediately — confirm `segment_exit` releases look sane and no `fixed` agent's `cohortAssignedAt` changed.

---

## Self-Review Notes (resolved design decisions)

- **Enrollment mode**: Fixed vs Continuous (open enrollment + `segment_exit`). `fixed` is the default — zero behavior change for existing agents.
- **Conversion category**: per-goal `conversionType` (`first_interaction` | `any_interaction`); an agent may mix.
- **Type-A baseline**: snapshot interaction flags onto `UserAgentAssignment.enrollmentFlags` at enrollment (both cohort-freeze and continuous paths).
- **Flag conversions are attribute transitions, not events** → detected in `/api/ingest/users`, credited through the existing `applyConversion` path against the owning agent's most recent unconverted decision. No attributable decision ⇒ logged unmatched, not an error (reward requires a prior send).
- **Open assumption to confirm with the user during/after build**: Type-B crediting for users already `true` at enrollment fires on the first post-enrollment sync. If the user instead wants Type-B to require an in-window transition, change the `any_interaction` branch in `detectFlagConversions` to also require `!normalizeFlag(stored[flag])`.
