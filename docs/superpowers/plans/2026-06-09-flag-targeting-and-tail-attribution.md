# Interaction-Flag Targeting + 30-Day Tail Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any agent target users whose `*_has_ever_flag` is false via rule segments, and credit flag-flip conversions up to 30 days after the agent's last send even when the user was released or re-enrolled elsewhere.

**Architecture:** (1) Add the 9 canonical interaction flags to the segment field catalog as boolean fields with a new `absentFalse` compile option (`COALESCE((attributes->>'flag')::boolean, false)`), so absent = false matches the Hightouch `| default: false` contract. (2) In `POST /api/ingest/users`, after the existing active-assignment conversion path, add a "tail" path: for each flag that observably transitioned false→true this sync and was not handled by the active path, credit the user's most recent unconverted `UserDecision` within 30 days whose agent has a goal for that flag. `applyConversion` is already correctly scoped (release-on-conversion filters by `agentId`), so no changes there.

**Tech Stack:** Next.js App Router route handlers, Prisma v7, bun:test. Spec: `docs/superpowers/specs/2026-06-09-flag-targeting-attribution-design.md`.

**Verification commands:** `bun run test:quick` (unit, no DB) and `bun test tests/regression/<file> tests/integration/<file>` style targeted runs need the test DB; integration/regression files run one-process-each via `bun run test:int`. Use `TEST_FILES=...` env to restrict (see `scripts/run-int-reg.ts`). Full gate before MR: `bun run check`.

---

### Task 1: `absentFalse` boolean compile + 9 flag fields in the catalog

**Files:**
- Modify: `src/lib/segments/field-catalog.ts`
- Modify: `src/lib/segments/compile-sql.ts:27-33`
- Test: `tests/unit/segment-compile-sql.test.ts`
- Test: `tests/unit/segment-field-catalog.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/segment-compile-sql.test.ts` (inside the existing `describe("compileSegmentRule", ...)`, after the `"attr boolean is_true uses no value param"` test; `g`/`c` helpers already exist at the top of the file):

```ts
  it("interaction-flag boolean wraps in COALESCE so absent counts as false", () => {
    const r = compileSegmentRule(g("AND", [c("votd_interaction_has_ever_flag", "is_false", null)]));
    expect(r.sql).toBe(
      `(COALESCE((u."attributes"->>'votd_interaction_has_ever_flag')::boolean, false) = false)`,
    );
    expect(r.params).toEqual([]);
  });

  it("interaction-flag is_true also goes through COALESCE", () => {
    const r = compileSegmentRule(g("AND", [c("plan_interaction_has_ever_flag", "is_true", null)]));
    expect(r.sql).toBe(
      `(COALESCE((u."attributes"->>'plan_interaction_has_ever_flag')::boolean, false) = true)`,
    );
    expect(r.params).toEqual([]);
  });

  it("plain boolean fields (no absentFalse) keep their exact pre-existing SQL shape", () => {
    const r = compileSegmentRule(g("AND", [c("has_recurring_gift", "is_false", null)]));
    expect(r.sql).toBe(`((u."attributes"->>'has_recurring_gift')::boolean = false)`);
    expect(r.params).toEqual([]);
  });
```

Append to `tests/unit/segment-field-catalog.test.ts` (new describe at the bottom; match the file's existing import style — it already imports `getField` or `FIELD_CATALOG` from `@/lib/segments/field-catalog`; add `INTERACTION_FLAGS` import from `@/lib/constants/interaction-flags`):

```ts
import { INTERACTION_FLAGS, INTERACTION_FLAG_LABELS } from "@/lib/constants/interaction-flags";

describe("interaction-flag fields", () => {
  it("every canonical interaction flag is a boolean attribute field with absent-as-false compile", () => {
    for (const flag of INTERACTION_FLAGS) {
      const f = getField(flag);
      expect(f).toBeDefined();
      expect(f!.label).toBe(INTERACTION_FLAG_LABELS[flag]);
      expect(f!.category).toBe("attribute");
      expect(f!.type).toBe("boolean");
      expect(f!.operators).toEqual(["is_true", "is_false", "exists", "nexists"]);
      expect(f!.compile).toEqual({ strategy: "attr", key: flag, cast: "boolean", absentFalse: true });
    }
  });
});
```

(If the test file imports `FIELD_CATALOG` instead of `getField`, use `FIELD_CATALOG.find((x) => x.id === flag)` — keep whichever import the file already has.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/segment-compile-sql.test.ts tests/unit/segment-field-catalog.test.ts`
Expected: FAIL — "Unknown segment field: votd_interaction_has_ever_flag" and undefined field lookups.

- [ ] **Step 3: Implement catalog + compile changes**

In `src/lib/segments/field-catalog.ts`:

Add the import at the top (line 2 area):

```ts
import { INTERACTION_FLAGS, INTERACTION_FLAG_LABELS } from "@/lib/constants/interaction-flags";
```

Extend the `attr` variant of `FieldCompile` (line 6):

```ts
  | { strategy: "attr"; key: string; cast: "text" | "numeric" | "boolean"; absentFalse?: boolean }
```

Below the `FUNNEL_ENUM` const (line 31), add:

```ts
// Hightouch syncs these with `| default: false`, so an absent attribute means
// false — the compile must COALESCE, otherwise `is_false` would silently drop
// users who have never been synced with the flag at all.
const INTERACTION_FLAG_FIELDS: FieldDef[] = INTERACTION_FLAGS.map((flag) => ({
  id: flag,
  label: INTERACTION_FLAG_LABELS[flag],
  category: "attribute",
  type: "boolean",
  operators: BOOL_OPS,
  compile: { strategy: "attr", key: flag, cast: "boolean", absentFalse: true },
}));
```

In the `FIELD_CATALOG` array, after the `preferred_channel_overall_30_days` entry (line 48), splice in:

```ts
  ...INTERACTION_FLAG_FIELDS,
```

Note: `BOOL_OPS` is `["is_true", "is_false", "exists", "nexists"]` (line 27) — matches the test expectation. `INTERACTION_FLAG_FIELDS` must be defined AFTER `BOOL_OPS` in the file or hoisting breaks (`const` TDZ); placing it after `FUNNEL_ENUM` satisfies this.

In `src/lib/segments/compile-sql.ts`, replace the boolean cast line in `fieldSqlExpr` (lines 29–31):

```ts
      const expr = compile.cast === "numeric" ? `(${base})::numeric`
        : compile.cast === "boolean"
          ? compile.absentFalse
            ? `COALESCE((${base})::boolean, false)`
            : `(${base})::boolean`
          : base;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/segment-compile-sql.test.ts tests/unit/segment-field-catalog.test.ts`
Expected: PASS (all, including pre-existing tests — the plain-boolean shape test proves no drift for existing fields).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/lib/segments/field-catalog.ts src/lib/segments/compile-sql.ts tests/unit/segment-compile-sql.test.ts tests/unit/segment-field-catalog.test.ts
git commit -m "feat(segments): interaction-flag boolean fields with absent-as-false compile"
```

---

### Task 2: `detectTransitionedFlags` pure helper + 30-day window constant

**Files:**
- Modify: `src/lib/constants/interaction-flags.ts`
- Test: `tests/unit/interaction-flags.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/interaction-flags.test.ts` (add `detectTransitionedFlags, FLAG_ATTRIBUTION_WINDOW_MS` to the existing import from `@/lib/constants/interaction-flags`):

```ts
describe("detectTransitionedFlags", () => {
  it("returns flags that flipped false/absent → true this sync", () => {
    const res = detectTransitionedFlags(
      { votd_interaction_has_ever_flag: true, plan_interaction_has_ever_flag: true },
      { plan_interaction_has_ever_flag: true }, // already true — no transition
    );
    expect(res).toEqual(["votd_interaction_has_ever_flag"]);
  });

  it("absent incoming or false incoming is never a transition", () => {
    expect(detectTransitionedFlags({}, {})).toEqual([]);
    expect(detectTransitionedFlags({ votd_interaction_has_ever_flag: false }, {})).toEqual([]);
  });

  it("is type-tolerant on both sides (string/int forms)", () => {
    expect(
      detectTransitionedFlags(
        { votd_interaction_has_ever_flag: "true" },
        { votd_interaction_has_ever_flag: "false" },
      ),
    ).toEqual(["votd_interaction_has_ever_flag"]);
    expect(
      detectTransitionedFlags(
        { votd_interaction_has_ever_flag: 1 },
        { votd_interaction_has_ever_flag: "t" }, // stored already truthy
      ),
    ).toEqual([]);
  });

  it("ignores non-flag keys", () => {
    expect(detectTransitionedFlags({ some_other_flag: true }, {})).toEqual([]);
  });
});

describe("FLAG_ATTRIBUTION_WINDOW_MS", () => {
  it("is 30 days", () => {
    expect(FLAG_ATTRIBUTION_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/interaction-flags.test.ts`
Expected: FAIL — `detectTransitionedFlags` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/constants/interaction-flags.ts` (after `snapshotEnrollmentFlags`):

```ts
// A flag flip credits an agent for up to 30 days after that agent's last send
// to the user, regardless of release status (spec 2026-06-09, user decision).
export const FLAG_ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pure: which canonical flags observably transitioned false/absent → true in
 * this sync, comparing incoming payload against PRE-upsert stored attributes.
 * Used by the post-release "tail" attribution path, which deliberately requires
 * an observed transition (never credits an already-true stored flag) because
 * the enrollment baseline may no longer exist once the assignment row has been
 * released or overwritten by another agent's enrollment.
 */
export function detectTransitionedFlags(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>,
): InteractionFlag[] {
  return INTERACTION_FLAGS.filter(
    (f) => normalizeFlag(incoming[f]) && !normalizeFlag(stored[f]),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/interaction-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants/interaction-flags.ts tests/unit/interaction-flags.test.ts
git commit -m "feat(conversions): detectTransitionedFlags helper + 30-day attribution window constant"
```

---

### Task 3: 30-day tail attribution in POST /api/ingest/users

**Files:**
- Modify: `src/app/api/ingest/users/route.ts:1080-1154` (the "Interaction-flag conversion detection" block)
- Test: `tests/regression/ingest-flag-tail-attribution.test.ts` (create)

Background for the implementer: today the block at lines 1080–1154 only credits flips when the user has an ACTIVE assignment (`releasedAt: null`) — flips after release are silently dropped (that is the bug this task fixes). `applyConversion` (`src/lib/services/attribution-service.ts`) already: (a) guards double-credit via `updateMany({ where: { id, conversionAt: null } })`, (b) scopes release-on-conversion to `{ externalUserId, agentId: decision.agentId, releasedAt: null }`, and (c) clears the lock only when that release matched. So a tail credit to agent A can never release/unlock a user actively owned by agent B. No changes to `applyConversion`.

- [ ] **Step 1: Write the failing regression test**

Create `tests/regression/ingest-flag-tail-attribution.test.ts`:

```ts
// Regression (spec 2026-06-09 flag-targeting-attribution): flag-flip conversions
// were only credited when the user had an ACTIVE assignment (releasedAt: null) —
// a user released (segment_exit, hold cap, manual) whose flag flipped LATER was
// silently dropped. New rule: a flip credits the most recent unconverted decision
// within 30 days of sentAt whose agent has a goal for that flag (most recent
// send wins), regardless of release status. The tail path requires an observed
// false/absent → true transition vs pre-upsert stored attributes.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createGoal,
  createMessage,
  createVariant,
  createUser,
  createUserDecision,
  createUserAgentAssignment,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };
const DAY = 24 * 60 * 60 * 1000;
const FLAG = "votd_interaction_has_ever_flag";

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

function syncUser(externalId: string, attributes: Record<string, unknown>) {
  const req = buildRequest(
    "POST",
    { users: [{ external_user_id: externalId, attributes }] },
    AUTH,
  );
  return POST(req as NextRequest);
}

// Agent with a first_interaction goal on FLAG, one variant, one decision sent
// `sentDaysAgo` days ago, and a RELEASED assignment.
async function setupReleasedAgent(userId: string, sentDaysAgo: number) {
  const agent = await createAgent();
  await createGoal(agent.id, {
    eventName: FLAG,
    tier: "very_good",
    valueWeight: 5,
    weightMode: "fixed",
    weightDefault: 5,
    conversionType: "first_interaction",
  });
  const msg = await createMessage(agent.id);
  const variant = await createVariant(msg.id);
  const decision = await createUserDecision({
    agentId: agent.id,
    userId,
    messageVariantId: variant.id,
    sentAt: new Date(Date.now() - sentDaysAgo * DAY),
  });
  await createUserAgentAssignment({
    externalUserId: userId,
    agentId: agent.id,
    enrollmentFlags: { [FLAG]: false },
    releasedAt: new Date(Date.now() - 1 * DAY),
    releaseReason: "hold_cap_days",
  });
  return { agent, decision };
}

describe("tail attribution: flips after release still credit within 30 days", () => {
  it("released user, flip 10 days after send → credited; release reason untouched", async () => {
    await createUser("usr_tail_hit");
    const { agent, decision } = await setupReleasedAgent("usr_tail_hit", 10);

    const res = await syncUser("usr_tail_hit", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).not.toBeNull();
    expect(updated!.conversionEvent).toBe(FLAG);
    expect(updated!.reward as number).toBeGreaterThan(0);

    // Already-released assignment is untouched (release-on-conversion no-ops).
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_tail_hit" },
    });
    expect(assignment!.releaseReason).toBe("hold_cap_days");

    // Reporting: same count the dashboards run (conversionAt, no release filter).
    const counted = await prisma.userDecision.count({
      where: { agentId: agent.id, conversionAt: { not: null } },
    });
    expect(counted).toBe(1);
  });

  it("flip 31 days after the send → NOT credited", async () => {
    await createUser("usr_tail_late");
    const { decision } = await setupReleasedAgent("usr_tail_late", 31);

    const res = await syncUser("usr_tail_late", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).toBeNull();
  });

  it("flip with no prior send → no credit, sync still succeeds", async () => {
    await createUser("usr_tail_nosend");
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "first_interaction",
    });
    await createUserAgentAssignment({
      externalUserId: "usr_tail_nosend",
      agentId: agent.id,
      enrollmentFlags: { [FLAG]: false },
      releasedAt: new Date(Date.now() - 1 * DAY),
      releaseReason: "manual",
    });

    const res = await syncUser("usr_tail_nosend", { [FLAG]: true });
    expect(res.status).toBe(200);
    const count = await prisma.userDecision.count({ where: { conversionAt: { not: null } } });
    expect(count).toBe(0);
  });

  it("most recent send wins when two agents both track the flag", async () => {
    await createUser("usr_tail_two");
    // Agent A sent 10 days ago; released. (Assignment row is globally unique per
    // user, so only ONE assignment exists — history lives in decisions.)
    const { decision: decisionA } = await setupReleasedAgent("usr_tail_two", 10);
    // Agent B sent 2 days ago (decision only — A's released row owns the slot).
    const agentB = await createAgent({ name: "Tail Agent B" });
    await createGoal(agentB.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "any_interaction",
    });
    const msgB = await createMessage(agentB.id);
    const variantB = await createVariant(msgB.id);
    const decisionB = await createUserDecision({
      agentId: agentB.id,
      userId: "usr_tail_two",
      messageVariantId: variantB.id,
      sentAt: new Date(Date.now() - 2 * DAY),
    });

    const res = await syncUser("usr_tail_two", { [FLAG]: true });
    expect(res.status).toBe(200);

    const b = await prisma.userDecision.findUnique({ where: { id: decisionB.id } });
    const a = await prisma.userDecision.findUnique({ where: { id: decisionA.id } });
    expect(b!.conversionAt).not.toBeNull(); // most recent send wins
    expect(a!.conversionAt).toBeNull();
  });

  it("tail credit to agent A never releases agent B's ACTIVE assignment", async () => {
    await createUser("usr_tail_safe");
    // Agent A: goal + decision 5 days ago, but NO assignment row (overwritten).
    const agentA = await createAgent({ name: "Tail Agent A" });
    await createGoal(agentA.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "first_interaction",
    });
    const msgA = await createMessage(agentA.id);
    const variantA = await createVariant(msgA.id);
    const decisionA = await createUserDecision({
      agentId: agentA.id,
      userId: "usr_tail_safe",
      messageVariantId: variantA.id,
      sentAt: new Date(Date.now() - 5 * DAY),
    });
    // Agent B: currently owns the user, no flag goals.
    const agentB = await createAgent({ name: "Owner Agent B" });
    await createUserAgentAssignment({
      externalUserId: "usr_tail_safe",
      agentId: agentB.id,
    });
    await prisma.trackedUser.update({
      where: { externalId: "usr_tail_safe" },
      data: { lockedByAgentId: agentB.id },
    });

    const res = await syncUser("usr_tail_safe", { [FLAG]: true });
    expect(res.status).toBe(200);

    const a = await prisma.userDecision.findUnique({ where: { id: decisionA.id } });
    expect(a!.conversionAt).not.toBeNull(); // A credited via tail

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_tail_safe" },
    });
    expect(assignment!.agentId).toBe(agentB.id);
    expect(assignment!.releasedAt).toBeNull(); // B untouched
    const tu = await prisma.trackedUser.findUnique({ where: { externalId: "usr_tail_safe" } });
    expect(tu!.lockedByAgentId).toBe(agentB.id); // lock untouched
  });

  it("stored flag already true → re-sync of true is no transition, no tail credit", async () => {
    await createUser("usr_tail_alreadytrue", { attributes: { [FLAG]: true } });
    const { decision } = await setupReleasedAgent("usr_tail_alreadytrue", 5);

    const res = await syncUser("usr_tail_alreadytrue", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).toBeNull();
  });

  it("ACTIVE assignment path still wins over the tail (no behavior change for owned users)", async () => {
    await createUser("usr_tail_active");
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "first_interaction",
    });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: "usr_tail_active",
      messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 1 * DAY),
    });
    await createUserAgentAssignment({
      externalUserId: "usr_tail_active",
      agentId: agent.id,
      enrollmentFlags: { [FLAG]: false },
    });

    const res = await syncUser("usr_tail_active", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).not.toBeNull();
    // Exactly one credit — the tail must not double-fire for the same flag.
    const count = await prisma.userDecision.count({
      where: { userId: "usr_tail_active", conversionAt: { not: null } },
    });
    expect(count).toBe(1);
    // Active-path release-on-conversion still applies.
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_tail_active" },
    });
    expect(assignment!.releaseReason).toBe("conversion");
  });
});
```

Note for the implementer: if `createUser(externalId, { attributes })` in `tests/helpers/builders.ts` does not accept an `attributes` override, set it directly after creation with `prisma.trackedUser.update({ where: { externalId }, data: { attributes: { [FLAG]: true } } })` in the already-true test. Check the builder first.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:int` with only this file (set `TEST_FILES=tests/regression/ingest-flag-tail-attribution.test.ts` if supported by `scripts/run-int-reg.ts`; otherwise `bun test tests/regression/ingest-flag-tail-attribution.test.ts` against the test DB env).
Expected: the tail tests FAIL (no credit happens — `conversionAt` stays null); the active-path test PASSES (existing behavior).

- [ ] **Step 3: Implement the tail path**

In `src/app/api/ingest/users/route.ts`:

Add to the existing import from `@/lib/constants/interaction-flags` (the route already imports `isInteractionFlag, normalizeFlag` — extend it):

```ts
import {
  isInteractionFlag,
  normalizeFlag,
  detectTransitionedFlags,
  FLAG_ATTRIBUTION_WINDOW_MS,
} from "@/lib/constants/interaction-flags";
```

(Keep whatever names the existing import statement already has; just add the two new ones.)

Replace the interaction-flag block (lines 1087–1154, from `let unmatchedFlagConversions = 0;` through the closing `catch`) with:

```ts
      let unmatchedFlagConversions = 0;
      try {
        const storedAttrs = storedAttributesByUser.get(externalId) ?? {};
        const hasTruthyFlag = Object.entries(raw).some(
          ([k, v]) => isInteractionFlag(k) && normalizeFlag(v),
        );
        // Flags the ACTIVE-assignment path took responsibility for (whether or
        // not a decision slot existed) — the tail must not double-handle them.
        const handledFlags = new Set<string>();
        if (hasTruthyFlag) {
          const flagAssignment = await prisma.userAgentAssignment.findFirst({
            where: { externalUserId: externalId, releasedAt: null },
            select: { agentId: true, enrollmentFlags: true },
          });
          if (flagAssignment) {
            const { agentId: owningAgentId, enrollmentFlags: rawEnrollment } = flagAssignment;
            // Tolerant parse: corrupt/missing enrollmentFlags → null, so Type-A
            // detection falls back to the pre-upsert stored attributes instead of
            // an all-false baseline that would credit pre-enrollment engagement
            // as a "first interaction" (2026-06-09 audit, I1).
            const enrollmentFlags: Record<string, unknown> | null =
              rawEnrollment !== null &&
              typeof rawEnrollment === "object" &&
              !Array.isArray(rawEnrollment)
                ? (rawEnrollment as Record<string, unknown>)
                : null;

            // Goals are not cached yet for this agentId scope — fetch once per owned user.
            // (Agents with no flag goals are skipped quickly by detectFlagConversions.)
            const flagGoals = await getFlagGoals(owningAgentId, flagGoalsByAgent);

            const creditedFlags = detectFlagConversions({
              incoming: raw,
              // PRE-upsert attributes (preloaded per-chunk before the trackedUser
              // upsert above overwrote them) — any_interaction credits only on a
              // false→true transition. A brand-new user has no stored row → {}.
              stored: storedAttrs,
              enrollmentFlags,
              goals: flagGoals,
            });

            // Each credited flag independently attributes to the most recent remaining
            // unconverted decision, so two flags flipping in one sync may consume two
            // decisions. When decisions run out, remaining flags are tallied as unmatched.
            // Only the no-decision case is unmatched; an already-credited decision ID
            // means this sync already consumed that slot — skip silently, don't count it.
            for (const flagName of creditedFlags) {
              handledFlags.add(flagName);
              const flagDecision = await prisma.userDecision.findFirst({
                where: { userId: externalId, agentId: owningAgentId, conversionAt: null },
                orderBy: { sentAt: "desc" },
                include: { agent: { include: { goals: true } } },
              });
              if (flagDecision === null) {
                // No unconverted decision exists — flag fired but there was no prior send.
                unmatchedFlagConversions++;
              } else if (!creditedDecisionIds.has(flagDecision.id)) {
                await applyConversion({
                  decision: flagDecision,
                  conversionEvent: flagName,
                  occurredAt: new Date(),
                  personaId,
                });
                creditedDecisionIds.add(flagDecision.id);
              }
              // else: this decision was already credited in an earlier loop iteration —
              // skip silently; it is not an unmatched conversion.
            }
          }
        }

        // ── 30-day tail attribution ──────────────────────────────────────────
        // A flip after release (segment_exit, hold cap, manual) — or after the
        // assignment row was overwritten by another agent — still credits the
        // most recent unconverted decision within FLAG_ATTRIBUTION_WINDOW_MS
        // whose agent has a goal for that flag (most recent send wins). Requires
        // an observed false/absent → true transition vs pre-upsert attributes:
        // the enrollment baseline may no longer exist, so an already-true stored
        // flag never tail-credits. applyConversion scopes release-on-conversion
        // to the credited agentId, so a tail credit never releases a user from
        // a different agent that currently owns them.
        for (const flagName of detectTransitionedFlags(raw, storedAttrs)) {
          if (handledFlags.has(flagName)) continue;
          const tailDecision = await prisma.userDecision.findFirst({
            where: {
              userId: externalId,
              conversionAt: null,
              sentAt: { gte: new Date(Date.now() - FLAG_ATTRIBUTION_WINDOW_MS) },
              agent: { goals: { some: { eventName: flagName, conversionType: { not: null } } } },
            },
            orderBy: { sentAt: "desc" },
            include: { agent: { include: { goals: true } } },
          });
          if (tailDecision !== null && !creditedDecisionIds.has(tailDecision.id)) {
            await applyConversion({
              decision: tailDecision,
              conversionEvent: flagName,
              occurredAt: new Date(),
              personaId,
            });
            creditedDecisionIds.add(tailDecision.id);
          }
          // No qualifying decision = organic flip with no recent Nexus send —
          // intentionally not counted as "unmatched" (that tally is owner telemetry).
        }
      } catch (err) {
        console.error("[ingest/users] interaction-flag conversion failed:", err);
      }
```

The only behavioral deltas vs the original block: (a) `storedAttrs` hoisted to a const shared by both paths, (b) `handledFlags` tracking, (c) the new tail loop. The active-assignment path is otherwise verbatim.

- [ ] **Step 4: Run the regression test to verify it passes**

Run: same command as Step 2.
Expected: PASS — all 7 tests.

- [ ] **Step 5: Run the neighboring suites to verify no regressions**

Run integration/regression files touching this route: `tests/integration/interaction-flag-conversion.test.ts`, `tests/integration/ingest-users.test.ts`, `tests/integration/ingest-users-recovery.test.ts`, `tests/regression/ingest-users-preferred-channel-flag-fields.test.ts` (one process each, per the runner).
Expected: PASS. If `interaction-flag-conversion.test.ts` has a case asserting "released user gets NO credit", read it — under the new spec that expectation flips; update the test to assert the tail credit instead and note the spec in a comment.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ingest/users/route.ts tests/regression/ingest-flag-tail-attribution.test.ts
git commit -m "feat(conversions): 30-day tail attribution for flag flips after release"
```

---

### Task 4: End-to-end — rule segment on a flag field enrolls only flag-false users

**Files:**
- Test: `tests/integration/flag-rule-segment-materialize.test.ts` (create)

No production code — this proves Task 1 composes with the existing materialization + targeting pipeline (mirrors `tests/integration/select-and-send-consumes-rule-segments.test.ts`).

- [ ] **Step 1: Write the test**

Create `tests/integration/flag-rule-segment-materialize.test.ts`:

```ts
// E2E for interaction-flag targeting (spec 2026-06-09): a rule segment on
// votd_interaction_has_ever_flag is_false materializes flag-false AND
// flag-absent users (absent = false per the Hightouch default contract), and
// excludes flag-true users. Membership rows are what select-and-send consumes.
import { describe, it, expect, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { materializeAllSegments } from "@/lib/segments/materialize";
import { createUser } from "../helpers/builders";

const VOTD_FALSE_RULE = {
  kind: "group",
  join: "AND",
  children: [
    { kind: "condition", fieldId: "votd_interaction_has_ever_flag", operator: "is_false", value: null },
  ],
};

describe("rule segment on an interaction flag", () => {
  beforeEach(async () => {
    await prisma.userSegment.deleteMany();
    await prisma.trackedUser.deleteMany();
    await prisma.segment.deleteMany();
  });

  it("materializes flag-false and flag-absent users; excludes flag-true", async () => {
    await createUser("usr_votd_false", { attributes: { votd_interaction_has_ever_flag: false } });
    await createUser("usr_votd_absent"); // no flag attribute at all
    await createUser("usr_votd_true", { attributes: { votd_interaction_has_ever_flag: true } });
    await prisma.segment.create({
      data: { name: "votd-never-interacted", rule: VOTD_FALSE_RULE as Prisma.InputJsonValue },
    });

    await materializeAllSegments({ runStart: new Date() });

    const rows = await prisma.userSegment.findMany({
      where: { segmentName: "votd-never-interacted" },
      select: { externalId: true },
    });
    expect(new Set(rows.map((r) => r.externalId))).toEqual(
      new Set(["usr_votd_false", "usr_votd_absent"]),
    );
  });
});
```

Note: `createUser` defaults include `attributes: { newsletter_push_enabled: true, newsletter_email_enabled: true, language_tag: "en" }`. If the `attributes` override REPLACES the default object (check `tests/helpers/builders.ts`), that is fine for this test — the rule only inspects the votd key. If `createUser` doesn't accept an `attributes` override at all, create then `prisma.trackedUser.update` the attributes.

- [ ] **Step 2: Run it — it should pass already**

Run: `bun test tests/integration/flag-rule-segment-materialize.test.ts` against the test DB.
Expected: PASS (Tasks 1's compile change is the enabling code). If `usr_votd_absent` is missing from members, the COALESCE in Task 1 Step 3 is wrong — fix there, not here.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/flag-rule-segment-materialize.test.ts
git commit -m "test(segments): flag-false rule segment materializes absent-as-false members"
```

---

### Task 5: Full gate + ship

- [ ] **Step 1: Full check**

Run: `bun run check`
Expected: typecheck + lint + all suites green. Do NOT trust a piped exit code (`| tail` swallows failures in zsh) — read the output for "Bailed out" / failures.

- [ ] **Step 2: Ship via MR**

Direct pushes to main are blocked by a hook. Flow:

```bash
git checkout -b feat/flag-targeting-tail-attribution
git push -u origin feat/flag-targeting-tail-attribution
glab mr create --title "feat: interaction-flag targeting + 30-day tail attribution" --description "Spec: docs/superpowers/specs/2026-06-09-flag-targeting-attribution-design.md

- 9 interaction flags in the segment field catalog (absent = false COALESCE compile)
- 30-day post-release tail attribution for flag flips in POST /api/ingest/users
- regression + e2e tests" --source-branch feat/flag-targeting-tail-attribution --target-branch main
glab mr merge <MR_NUMBER> --remove-source-branch   # merge by NUMBER, not branch name (405 otherwise)
git checkout main && git pull
```

- [ ] **Step 3: Post-merge production ops (manual, with the user)**

1. Wait for the Vercel deploy of main.
2. In the Segments builder UI, create segment `votd-never-interacted` with rule: `votd_interaction_has_ever_flag` `is_false`. Trigger/await materialization.
3. Update Oracle (id `cmq7d6quy000004jp7ytsu75h`): `segmentTargeting.includes = ["new_user_21day_10percent", "votd-never-interacted"]`. Keep continuous mode and the existing `first_interaction` goal.
4. Oracle stays `draft` until the user flips it live.

---

## Self-Review Notes

- **Spec coverage:** Part 1 (targeting) → Tasks 1+4; Part 2 (tail attribution) → Tasks 2+3; Part 3 (reporting) → Task 3 test 1's dashboard-count assertion; Part 4 (Oracle ops) → Task 5 Step 3. applyConversion release-scoping guard from the spec: verified already correct in code (attribution-service.ts:107), pinned by Task 3's "never releases agent B" test.
- **Type consistency:** `detectTransitionedFlags(incoming, stored): InteractionFlag[]` and `FLAG_ATTRIBUTION_WINDOW_MS` defined in Task 2, consumed in Task 3 with matching signatures. `absentFalse?: boolean` defined in Task 1 catalog type and read in Task 1 compile change only.
- **Known judgment calls baked in:** active-owner path takes precedence per flag even when it ends "unmatched" (owner existed but never sent → no credit, tail does not shop the flip to other agents); tail no-decision case is not counted in `unmatchedFlagConversions` (that tally means "owned user flipped with no send slot").

---
---

# Part B — Unified Agent Settings Editing

> **For agentic workers:** Same execution rules as Part A. Ship Part B as its OWN branch + MR after Part A merges (Task 9). Do not mix the two changesets.

**Goal:** One edit mode for agents — every editable setting lives in a single "Settings" tab on the agent detail page (edit-in-place where settings are viewed), replacing the dual Edit-sheet / `/agents/[id]/scheduling`-page split. `uniqueUsersCap` (Max Unique Users) becomes editable.

**Architecture:** A new client component `AgentSettingsEditor` merges the form sections of `agent-edit-sheet.tsx` (492 lines), `scheduling-editor.tsx` (517 lines), and `fallback-send-time-editor.tsx` (109 lines) into one sectioned, view/edit-toggled tab. It saves through the existing two routes — `PATCH /api/agents/[id]` for Agent fields and `PUT /api/agents/[id]/scheduling` for SchedulingRule fields — sending **only dirty fields** (the PATCH route change-detects cohort release, but sending only dirty fields is defense in depth per the 2026-06-09 I2 audit). The old surfaces are deleted; `/agents/[id]/scheduling` redirects to `/agents/[id]?tab=settings`.

**Current state (verified 2026-06-09):**
- Detail page `src/app/agents/[id]/page.tsx` (890 lines, Server Component): `<Tabs defaultValue="overview">` at line 138 — **client-state only, no URL param**. `AgentEditSheet` mounted at line 106. Read-only Scheduling/Send-Limits cards at lines 376–459 with "Edit these via the Edit button above" note (line ~456) and a link to `/agents/[id]/scheduling` (line 380). `FallbackSendTimeEditor` inline at line 431. Draft checklist links to `/agents/${agent.id}/scheduling` (line ~184).
- `AgentEditSheet` edits: name, description, color, algorithm, epsilon, funnelStage / targetSegmentName (HT segment) toggle, segmentTargeting includes/excludes, dailySendCap, deeplinkOverride. Fetches `/api/segments` on open (line 210). Uses `AgentDeeplinkOverrideField` subcomponent.
- `SchedulingEditor` (props `{ agentId, initialRule: SchedulingRule | null }`) edits: frequencyCap, quietHours (3 modes + legacy-record normalization via `resolveInitialQuietHours`), blackoutDates, smartSuppress, suppressThresh, prioritizeLastSeen. Saves via `PUT /api/agents/[id]/scheduling` (accepts exactly those 6 fields, route lines 29–108, upserts SchedulingRule).
- `PATCH /api/agents/[id]` (route lines 45–251) accepts: name, description, algorithm, epsilon, funnelStage, status, targetFilter, targetSegmentName, segmentTargeting, fallbackSendHour, dailySendCap, languageFilter, localizePush, deeplinkOverride, sendingPaused, color, enrollmentMode. **Not** uniqueUsersCap. Cohort-release change-detection at lines 177–195; release + update atomic transaction at lines 202–241.
- `uniqueUsersCap`: `Agent` column, nullable Int, "null = unlimited" (prisma/schema.prisma:27). Editable nowhere.

**Design decisions (present to user with handoff; defaults below):**
1. The read-only "Scheduling" tab becomes an editable **"Settings"** tab containing ALL agent settings, grouped in cards: Identity (name/description/color), Algorithm (algorithm/epsilon), Targeting (mode toggle, segments, enrollmentMode), Sending (dailySendCap, uniqueUsersCap, fallbackSendHour, deeplinkOverride, languageFilter, localizePush), Guardrails (frequencyCap, quietHours, blackout, suppression).
2. View mode by default (current read-only presentation, now complete); a single **Edit** button flips the whole tab into form mode with a sticky Save/Cancel bar. One Save, one Cancel — no per-field modes.
3. Header "Edit" button and `AgentEditSheet` are removed; header button becomes a link to `?tab=settings&edit=1`.
4. `/agents/[id]/scheduling` becomes `redirect("/agents/[id]?tab=settings")` — old links/bookmarks keep working.
5. Changing `uniqueUsersCap` does **NOT** trigger cohort release (it's a recruitment ceiling, not targeting criteria; lowering it below current enrollment just halts new recruitment).
6. Targeting/enrollmentMode edits keep their existing destructive-change semantics (PATCH releases cohort on actual change) — the editor shows the same warning copy the sheet shows today before save when those fields are dirty.

---

### Task 6: `uniqueUsersCap` accepted by PATCH /api/agents/[id]

**Files:**
- Modify: `src/app/api/agents/[id]/route.ts` (validation after the dailySendCap block at lines 104–108; data spread alongside line 225)
- Test: `tests/integration/agents-patch-unique-users-cap.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/agents-patch-unique-users-cap.test.ts` following the existing agents-PATCH integration test pattern (admin-auth helper + builders from `tests/helpers/builders.ts`):

```ts
// Tests:
// 1. PATCH { uniqueUsersCap: 5000 } → 200, agent.uniqueUsersCap === 5000 in DB
// 2. PATCH { uniqueUsersCap: null } → 200, persisted null (unlimited)
// 3. PATCH { uniqueUsersCap: 0 } → 400
// 4. PATCH { uniqueUsersCap: -5 } → 400
// 5. PATCH { uniqueUsersCap: 1.5 } → 400
// 6. PATCH { uniqueUsersCap: "5000" } → 400
// 7. COHORT GUARD: create agent with cohortAssignedAt set + an active
//    UserAgentAssignment (releasedAt: null) via builders; PATCH only
//    { uniqueUsersCap: 9999 }; assert 200, assignment.releasedAt still null,
//    agent.cohortAssignedAt unchanged (cap change must NOT release the cohort).
```

Copy the request/auth scaffolding verbatim from the nearest existing `tests/integration/agents-*.test.ts` PATCH test.

- [ ] **Step 2: Run to verify failure**

Run: `TEST_FILES=tests/integration/agents-patch-unique-users-cap.test.ts bun run test:int`
Expected: tests 1–2 FAIL (cap not persisted — PATCH ignores the field), 3–6 FAIL (200 instead of 400), 7 passes vacuously or fails on persistence.

- [ ] **Step 3: Implement**

In `src/app/api/agents/[id]/route.ts`, insert after the `dailySendCap` validation block (after line 108):

```ts
    if (body.uniqueUsersCap !== undefined) {
      if (body.uniqueUsersCap !== null && (!Number.isInteger(body.uniqueUsersCap) || body.uniqueUsersCap < 1)) {
        return fail("uniqueUsersCap must be null or a positive integer", 400);
      }
    }
```

In the `tx.agent.update` data object, alongside the `dailySendCap` spread (line 225):

```ts
        ...(body.uniqueUsersCap !== undefined ? { uniqueUsersCap: body.uniqueUsersCap } : {}),
```

Do NOT touch the `releasesCohort` expression — uniqueUsersCap must not appear in it.

- [ ] **Step 4: Run tests to verify pass**

Run: `TEST_FILES=tests/integration/agents-patch-unique-users-cap.test.ts bun run test:int`
Expected: all 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/[id]/route.ts tests/integration/agents-patch-unique-users-cap.test.ts
git commit -m "feat(agents): make uniqueUsersCap editable via PATCH, without cohort release"
```

---

### Task 7: `AgentSettingsEditor` — unified Settings tab

**Files:**
- Create: `src/components/agents/agent-settings-editor.tsx`
- Modify: `src/app/agents/[id]/page.tsx` (tab rename + content swap, lines 138–172 and 376–459; wire `searchParams`)
- Test: `tests/unit/agent-settings-dirty-diff.test.ts` (new, for the extracted dirty-diff helper)
- Create: `src/lib/agents/settings-diff.ts` (pure dirty-field diff helper — business logic lives in lib, not the component)

- [ ] **Step 1: Write the failing test for the diff helper**

`tests/unit/agent-settings-dirty-diff.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { diffAgentSettings } from "@/lib/agents/settings-diff";

describe("diffAgentSettings", () => {
  it("returns only changed agent fields", () => {
    const { agentPatch, schedulingPut } = diffAgentSettings(
      { name: "A", dailySendCap: 50000, uniqueUsersCap: 100000, frequencyCap: { maxSends: 3, period: "week" } },
      { name: "A", dailySendCap: 60000, uniqueUsersCap: 100000, frequencyCap: { maxSends: 3, period: "week" } },
    );
    expect(agentPatch).toEqual({ dailySendCap: 60000 });
    expect(schedulingPut).toBeNull();
  });

  it("routes scheduling fields to schedulingPut", () => {
    const { agentPatch, schedulingPut } = diffAgentSettings(
      { frequencyCap: { maxSends: 3, period: "week" } },
      { frequencyCap: { maxSends: 5, period: "week" } },
    );
    expect(agentPatch).toBeNull();
    expect(schedulingPut).toEqual({ frequencyCap: { maxSends: 5, period: "week" } });
  });

  it("deep-compares JSON fields (segmentTargeting, quietHours) instead of reference-comparing", () => {
    const { agentPatch } = diffAgentSettings(
      { segmentTargeting: { includes: ["a"], excludes: [] } },
      { segmentTargeting: { includes: ["a"], excludes: [] } },
    );
    expect(agentPatch).toBeNull();
  });

  it("treats null vs value as a change", () => {
    const { agentPatch } = diffAgentSettings({ uniqueUsersCap: null }, { uniqueUsersCap: 5000 });
    expect(agentPatch).toEqual({ uniqueUsersCap: 5000 });
  });
});
```

`src/lib/agents/settings-diff.ts` contract: `diffAgentSettings(initial, edited)` → `{ agentPatch: object | null, schedulingPut: object | null }`. AGENT_FIELDS = name, description, color, algorithm, epsilon, funnelStage, targetSegmentName, segmentTargeting, enrollmentMode, dailySendCap, uniqueUsersCap, fallbackSendHour, deeplinkOverride, languageFilter, localizePush. SCHEDULING_FIELDS = frequencyCap, quietHours, blackoutDates, smartSuppress, suppressThresh, prioritizeLastSeen. Compare via `JSON.stringify` of normalized values (stable for these small shapes); a field appears in the output object only if changed; return null instead of `{}`.

- [ ] **Step 2: Run to verify failure, implement helper, verify pass**

Run: `TEST_FILES=tests/unit/agent-settings-dirty-diff.test.ts bun run test:quick` — FAIL (module missing) → implement → PASS.

- [ ] **Step 3: Build `AgentSettingsEditor`**

Create `src/components/agents/agent-settings-editor.tsx` (`"use client"`). This is a **relocation + composition** task — the form sections already exist and must move over verbatim (state hooks + JSX + their validation), then bind to one shared edit-mode state:

- Props: `{ agent: <serialized agent incl. uniqueUsersCap>, initialRule: SchedulingRule | null, startInEditMode?: boolean }`.
- `const [editing, setEditing] = useState(startInEditMode ?? false)` — view mode renders the current read-only card layout from `page.tsx:376–459` (move that JSX here, plus new read-only rows for the identity/algorithm/targeting/sending values the old tab never showed); edit mode renders the form sections.
- Form sections to relocate:
  - From `agent-edit-sheet.tsx`: name/description/color, algorithm/epsilon, targeting-mode toggle + funnelStage select + segment include/exclude pickers (incl. the `/api/segments` fetch — fetch on mount of edit mode, keep the "No segments synced yet" empty state), enrollmentMode toggle with its cohort-reset warning copy, dailySendCap input, `AgentDeeplinkOverrideField`.
  - From `scheduling-editor.tsx`: frequencyCap slider, quiet-hours mode cards (keep `resolveInitialQuietHours` legacy normalization, `HOUR_OPTIONS`, `DAYS_OF_WEEK`, `PERIOD_LABELS`), blackout dates, smartSuppress/suppressThresh, prioritizeLastSeen.
  - From `fallback-send-time-editor.tsx`: the fallbackSendHour select (as a plain field in the Sending card — drop its standalone save button).
  - New: **Max Unique Users** numeric input in the Sending card: empty = unlimited (null), min 1, helper text "Lifetime ceiling on distinct users this agent will enroll. Leave blank for unlimited. Lowering it does not release already-enrolled users."
- Save handler:

```ts
const onSave = async () => {
  setSaving(true);
  setError(null);
  const { agentPatch, schedulingPut } = diffAgentSettings(initialValues, currentValues);
  try {
    if (agentPatch) {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentPatch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save agent settings");
    }
    if (schedulingPut) {
      const res = await fetch(`/api/agents/${agent.id}/scheduling`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schedulingPut),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save scheduling");
    }
    setEditing(false);
    router.refresh(); // NOT location.reload() — respects revalidateTag caching
  } catch (e) {
    setError(e instanceof Error ? e.message : "Save failed");
  } finally {
    setSaving(false);
  }
};
```

- Sticky bottom bar in edit mode: `Save Changes` (disabled while saving / when nothing dirty) + `Cancel` (resets state to initial, exits edit mode). If targeting/enrollmentMode fields are dirty, show the sheet's existing cohort-release warning above the bar before save.
- In `src/app/agents/[id]/page.tsx`: rename the tab trigger `scheduling` → `settings` (label "Settings"), replace lines 376–459 content with `<AgentSettingsEditor agent={...} initialRule={...} startInEditMode={searchParams.edit === "1"} />`, and make tabs URL-addressable: page receives `searchParams: Promise<{ tab?: string; edit?: string }>`, `<Tabs defaultValue={tab ?? "overview"}>`. Remove the now-unused `FallbackSendTimeEditor` import/usage.

- [ ] **Step 4: Verify in browser**

`bun run dev` → `/agents/<id>` → Settings tab: view mode shows every setting; Edit → change Max Unique Users + a quiet-hours value → Save → both persist after refresh; Cancel discards; `?tab=settings&edit=1` deep-link opens straight into edit mode. Verify a save that only touches uniqueUsersCap does not blank `cohortAssignedAt` (check DB or the detail header badge).

- [ ] **Step 5: Commit**

```bash
git add src/components/agents/agent-settings-editor.tsx src/lib/agents/settings-diff.ts src/app/agents/[id]/page.tsx tests/unit/agent-settings-dirty-diff.test.ts
git commit -m "feat(agents): unified Settings tab editing all agent + scheduling fields in place"
```

---

### Task 8: Remove the old edit surfaces

**Files:**
- Delete: `src/components/agents/agent-edit-sheet.tsx`, `src/components/agents/fallback-send-time-editor.tsx`, `src/components/scheduling/scheduling-editor.tsx`
- Modify: `src/app/agents/[id]/scheduling/page.tsx` (→ redirect), `src/app/agents/[id]/page.tsx` (header Edit button at line ~106, draft-checklist link at line ~184)
- Test: `tests/regression/agent-settings-single-edit-surface.test.ts` (new)

- [ ] **Step 1: Write the failing regression test**

`tests/regression/agent-settings-single-edit-surface.test.ts` — pins the consolidation (DOM-structure style per project convention, happy-dom):

```ts
// 1. src/components/agents/agent-edit-sheet.tsx and
//    src/components/scheduling/scheduling-editor.tsx do not exist on disk
//    (fs.existsSync === false) — the dual edit surfaces stay dead.
// 2. The scheduling page module's rendered output is a redirect:
//    import the page component source (read file text) and assert it calls
//    redirect(`/agents/${id}?tab=settings`) and renders no form.
// 3. The detail page source contains exactly one editor entry point:
//    text includes "AgentSettingsEditor" and does NOT include "AgentEditSheet"
//    or a Link href ending in "/scheduling".
```

- [ ] **Step 2: Implement**

`src/app/agents/[id]/scheduling/page.tsx` becomes:

```tsx
import { redirect } from "next/navigation";

export default async function SchedulingRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/agents/${id}?tab=settings`);
}
```

In `src/app/agents/[id]/page.tsx`: replace the `<AgentEditSheet …/>` mount (line ~106) with a `<Link href={\`/agents/${agent.id}?tab=settings&edit=1\`}><Button variant="outline"><Pencil …/>Edit</Button></Link>`; update the draft-checklist `href` (line ~184) from `/agents/${agent.id}/scheduling` to `/agents/${agent.id}?tab=settings`. Delete the three dead component files and any now-unused imports (`AgentDeeplinkOverrideField` moves its import into the new editor). Run `grep -rn "agent-edit-sheet\|scheduling-editor\|fallback-send-time-editor" src/` — must return nothing.

- [ ] **Step 3: Run tests + verify in browser**

Run: `TEST_FILES=tests/regression/agent-settings-single-edit-surface.test.ts bun run test:int` → PASS.
Browser: header Edit button lands in Settings edit mode; visiting `/agents/<id>/scheduling` redirects to the Settings tab.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/agents/[id] src/components/agents src/components/scheduling tests/regression/agent-settings-single-edit-surface.test.ts
git commit -m "refactor(agents): remove edit sheet + scheduling page; Settings tab is the single edit surface"
```

---

### Task 9: Full gate + ship Part B

- [ ] **Step 1: Full check**

Run: `bun run check` — read output text, don't trust piped exit codes.

- [ ] **Step 2: Ship via MR** (after Part A's MR is merged)

```bash
git checkout -b feat/unified-agent-settings
git push -u origin feat/unified-agent-settings
glab mr create --title "feat: unified agent Settings tab + editable uniqueUsersCap" --description "- single edit surface on the agent detail page (Settings tab, edit-in-place)
- uniqueUsersCap editable via PATCH (no cohort release)
- /agents/[id]/scheduling redirects; edit sheet + scheduling editor removed" --source-branch feat/unified-agent-settings --target-branch main
glab mr merge <MR_NUMBER> --remove-source-branch   # merge by NUMBER
git checkout main && git pull
```

---

## Part B Self-Review Notes

- **Requirement coverage:** "one edit mode … same place where I can view the settings" → Tasks 7+8 (Settings tab, view/edit toggle, old surfaces deleted, old URL redirects); "max unique users editable" → Task 6 (API) + Task 7 (UI field).
- **Cohort safety:** uniqueUsersCap excluded from `releasesCohort` (Task 6 test 7 pins it); dirty-field diffing prevents echo-save cohort releases (Task 7 helper, unit-tested); targeting/mode warnings preserved.
- **Deferred (separate, queued task #32):** `/agents/new` creation-wizard UX overhaul — same design language as the Settings tab should be applied there afterwards.
