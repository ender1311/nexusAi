# Funnel Stage + Agent Targeting Predicate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `funnelStage` enum and `targetFilter` JSON predicate to every Agent so the decision engine can gate messaging to users who match both a persona and a flat attribute predicate.

**Architecture:** One Prisma migration adds `funnelStage FunnelStage @default(connected)` and `targetFilter Json?` to the Agent model. A new pure function `evaluateTargetFilter()` in `src/lib/engine/target-filter.ts` evaluates the predicate against user attributes + computed keys. `decideForUser()` gains an early-exit check after persona resolution; the cron route applies an in-memory filter pass over the loaded user page.

**Tech Stack:** Next.js 16 App Router, Prisma v7 + PostgreSQL (Neon), TypeScript, Bun test, shadcn/ui, Tailwind CSS v4.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `FunnelStage` enum + two fields to `Agent` |
| `src/types/agent.ts` | Modify | Add `FunnelStage` type, `FUNNEL_STAGES`, `FUNNEL_STAGE_META`, update `Agent` interface |
| `src/lib/engine/target-filter.ts` | **Create** | `ComputedUserKeys`, `buildComputedKeys`, `evaluateTargetFilter` |
| `tests/unit/target-filter.test.ts` | **Create** | Unit tests for every operator + computed key |
| `src/lib/decide.ts` | Modify | Step 3b: targetFilter gate after persona resolution |
| `src/app/api/cron/select-and-send/route.ts` | Modify | In-memory targetFilter pass before `decideForUser` |
| `src/app/api/agents/route.ts` | Modify | Accept `funnelStage` (required) + `targetFilter` in POST |
| `src/app/api/agents/[id]/route.ts` | Modify | Accept both fields in PATCH |
| `tests/helpers/builders.ts` | Modify | Add `funnelStage` to `createAgent()` |
| `tests/integration/agents.test.ts` | Modify | Add funnelStage + targetFilter round-trip + validation tests |
| `tests/integration/decide.test.ts` | Modify | Add targetFilter matching + exclusion cases |
| `src/components/agents/agent-card.tsx` | Modify | Stage badge next to status badge |
| `src/components/agents/agent-wizard.tsx` | Modify | Add `funnelStage` selector to Basic Info step |
| `src/app/agents/page.tsx` | Modify | Wire to real API, add stage filter bar |
| `src/app/agents/[id]/page.tsx` | Modify | Show funnelStage badge + targetFilter JSON block |
| `src/app/settings/page.tsx` | Modify | Remove Braze + BigQuery config cards |

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the FunnelStage enum and two fields to Agent**

Open `prisma/schema.prisma`. Add the enum block immediately before the `Agent` model, and add two fields inside `Agent` after the `epsilon` field:

```prisma
enum FunnelStage {
  new
  lapsed
  connected
  activated
  engaged
  inspired
}

model Agent {
  id          String      @id @default(cuid())
  name        String
  description String?
  status      String      @default("draft")
  algorithm   String      @default("thompson")
  epsilon     Float       @default(0.1)
  funnelStage FunnelStage @default(connected)
  targetFilter Json?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  goals          Goal[]
  messages       Message[]
  schedulingRule SchedulingRule?
  decisions      UserDecision[]
  metrics        ModelMetric[]
  personaTargets AgentPersonaTarget[]
}
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name add_funnel_stage_and_target_filter
```

Expected: Prisma creates `prisma/migrations/20260501.../migration.sql` with an `ALTER TABLE` adding `funnelStage` (with DEFAULT 'connected') and `targetFilter`. All existing agents get `funnelStage = 'connected'`.

- [ ] **Step 3: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: `src/generated/prisma/` is updated; the `FunnelStage` enum and new Agent fields appear in the generated types.

- [ ] **Step 4: Verify the client compiles**

```bash
bun run typecheck
```

Expected: No errors.

---

## Task 2: Engine types + `evaluateTargetFilter` (TDD)

**Files:**
- Modify: `src/types/agent.ts`
- Create: `src/lib/engine/target-filter.ts`
- Create: `tests/unit/target-filter.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/target-filter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";

const baseComputed = {
  last_seen_days: 5,
  total_decisions: 10,
  total_conversions: 2,
  persona_confidence: 0.8,
};

const makeUser = (overrides: Partial<{
  updatedAt: Date;
  totalDecisions: number;
  totalConversions: number;
  personaConfidence: number | null;
}> = {}) => ({
  updatedAt: overrides.updatedAt ?? new Date(),
  totalDecisions: overrides.totalDecisions ?? 0,
  totalConversions: overrides.totalConversions ?? 0,
  personaConfidence: overrides.personaConfidence ?? null,
});

describe("evaluateTargetFilter", () => {
  it("empty filter matches any user", () => {
    expect(evaluateTargetFilter({}, { attributes: {}, computed: baseComputed })).toBe(true);
  });

  it("__gte: passes when value >= threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__gte: fails when value < threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 6 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__lte: passes when value <= threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lte: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__lte: fails when value > threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lte: 4 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__gt: passes when value > threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gt: 4 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__gt: fails when value == threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gt: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__lt: passes when value < threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lt: 6 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__lt: fails when value == threshold", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__lt: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__eq (suffix): passes on exact match", () => {
    expect(evaluateTargetFilter(
      { total_decisions__eq: 10 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("no suffix is shorthand for __eq", () => {
    expect(evaluateTargetFilter(
      { total_decisions: 10 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("no suffix __eq: fails on mismatch", () => {
    expect(evaluateTargetFilter(
      { total_decisions: 99 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__neq: passes when values differ", () => {
    expect(evaluateTargetFilter(
      { total_decisions__neq: 99 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__neq: fails when values are equal", () => {
    expect(evaluateTargetFilter(
      { total_decisions__neq: 10 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__exists true: passes when attribute is present and non-null", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: true },
      { attributes: { giver_tier: "sower" }, computed: baseComputed }
    )).toBe(true);
  });

  it("__exists true: fails when attribute is absent", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: true },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("__exists false: passes when attribute is absent", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: false },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("__exists false: fails when attribute is present", () => {
    expect(evaluateTargetFilter(
      { giver_tier__exists: false },
      { attributes: { giver_tier: "sower" }, computed: baseComputed }
    )).toBe(false);
  });

  it("__in: passes when value is in the array", () => {
    expect(evaluateTargetFilter(
      { streak_status__in: ["active", "at_risk"] },
      { attributes: { streak_status: "active" }, computed: baseComputed }
    )).toBe(true);
  });

  it("__in: fails when value is not in the array", () => {
    expect(evaluateTargetFilter(
      { streak_status__in: ["active", "at_risk"] },
      { attributes: { streak_status: "broken" }, computed: baseComputed }
    )).toBe(false);
  });

  it("AND logic: all conditions must pass", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 3, total_decisions__gte: 5 },
      { attributes: {}, computed: baseComputed }
    )).toBe(true);
  });

  it("AND logic: one failing condition fails the whole filter", () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 3, total_decisions__gte: 100 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("unknown key returns false (no attribute or computed match)", () => {
    expect(evaluateTargetFilter(
      { nonexistent_key__gte: 1 },
      { attributes: {}, computed: baseComputed }
    )).toBe(false);
  });

  it("attribute keys are checked when not in computed", () => {
    expect(evaluateTargetFilter(
      { giver_tier: "sower" },
      { attributes: { giver_tier: "sower" }, computed: baseComputed }
    )).toBe(true);
  });

  it("computed keys override attributes of the same name", () => {
    // last_seen_days is a computed key — even if attributes has it, computed wins
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 3 },
      { attributes: { last_seen_days: 0 }, computed: baseComputed }
    )).toBe(true); // computed.last_seen_days = 5, passes
  });
});

describe("buildComputedKeys", () => {
  it("last_seen_days is derived from updatedAt", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 1000);
    const result = buildComputedKeys(makeUser({ updatedAt: twoDaysAgo }));
    expect(result.last_seen_days).toBe(2);
  });

  it("persona_confidence defaults to 0 when null", () => {
    const result = buildComputedKeys(makeUser({ personaConfidence: null }));
    expect(result.persona_confidence).toBe(0);
  });

  it("maps totalDecisions and totalConversions directly", () => {
    const result = buildComputedKeys(makeUser({ totalDecisions: 7, totalConversions: 3 }));
    expect(result.total_decisions).toBe(7);
    expect(result.total_conversions).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
bun test tests/unit/target-filter.test.ts
```

Expected: All tests FAIL with "Cannot find module '@/lib/engine/target-filter'".

- [ ] **Step 3: Create `src/lib/engine/target-filter.ts`**

```ts
export type ComputedUserKeys = {
  last_seen_days: number;
  total_decisions: number;
  total_conversions: number;
  persona_confidence: number;
};

type UserForComputed = {
  updatedAt: Date;
  totalDecisions: number;
  totalConversions: number;
  personaConfidence: number | null;
};

export function buildComputedKeys(user: UserForComputed): ComputedUserKeys {
  const msPerDay = 1000 * 60 * 60 * 24;
  return {
    last_seen_days: Math.floor((Date.now() - new Date(user.updatedAt).getTime()) / msPerDay),
    total_decisions: user.totalDecisions,
    total_conversions: user.totalConversions,
    persona_confidence: user.personaConfidence ?? 0,
  };
}

const OPERATORS = ["__gte", "__lte", "__gt", "__lt", "__eq", "__neq", "__exists", "__in"] as const;
type Operator = (typeof OPERATORS)[number];

function parseKey(rawKey: string): { key: string; op: Operator | "__eq" } {
  for (const suffix of OPERATORS) {
    if (rawKey.endsWith(suffix)) {
      return { key: rawKey.slice(0, -suffix.length), op: suffix };
    }
  }
  return { key: rawKey, op: "__eq" };
}

/**
 * Evaluates a flat JSON predicate against a user's attributes and computed keys.
 * All conditions are AND-ed. An empty predicate matches every user.
 * Computed keys take precedence over attributes of the same name.
 */
export function evaluateTargetFilter(
  filter: Record<string, unknown>,
  user: { attributes: Record<string, unknown>; computed: ComputedUserKeys }
): boolean {
  const merged: Record<string, unknown> = { ...user.attributes, ...user.computed };

  for (const [rawKey, expected] of Object.entries(filter)) {
    const { key, op } = parseKey(rawKey);
    const actual = merged[key];

    switch (op) {
      case "__gte":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual < expected) return false;
        break;
      case "__lte":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual > expected) return false;
        break;
      case "__gt":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual <= expected) return false;
        break;
      case "__lt":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual >= expected) return false;
        break;
      case "__eq":
        if (actual !== expected) return false;
        break;
      case "__neq":
        if (actual === expected) return false;
        break;
      case "__exists":
        if (expected === true && (actual === undefined || actual === null)) return false;
        if (expected === false && actual !== undefined && actual !== null) return false;
        break;
      case "__in":
        if (!Array.isArray(expected)) return false;
        if (!expected.includes(actual)) return false;
        break;
    }
  }

  return true;
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
bun test tests/unit/target-filter.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Update `src/types/agent.ts`**

Add `FunnelStage` type, `FUNNEL_STAGES` constant, `FUNNEL_STAGE_META` constant at the top of the file, and update the `Agent` interface:

```ts
// Add at the top, before existing exports:
export type FunnelStage = "new" | "lapsed" | "connected" | "activated" | "engaged" | "inspired";

export const FUNNEL_STAGES: FunnelStage[] = [
  "new", "lapsed", "connected", "activated", "engaged", "inspired",
];

export const FUNNEL_STAGE_META: Record<FunnelStage, { label: string; description: string }> = {
  new:       { label: "New",       description: "First installed < 28 days ago" },
  lapsed:    { label: "Lapsed",    description: "Last app use > 28 days ago" },
  connected: { label: "Connected", description: "MAU — monthly active users" },
  activated: { label: "Activated", description: "WAU — weekly/daily active users" },
  engaged:   { label: "Engaged",   description: "DEU — active 4+ days/week" },
  inspired:  { label: "Inspired",  description: "Givers & evangelists" },
};
```

In the `Agent` interface, add two fields after `epsilon`:

```ts
export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  status: AgentStatus;
  algorithm: Algorithm;
  epsilon: number;
  funnelStage: FunnelStage;
  targetFilter?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  goals?: Goal[];
  messages?: Message[];
  schedulingRule?: SchedulingRule | null;
  targetPersonaIds?: string[];
  _count?: {
    decisions: number;
  };
}
```

- [ ] **Step 6: Run typecheck**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine/target-filter.ts tests/unit/target-filter.test.ts src/types/agent.ts
git commit -m "feat(engine): add evaluateTargetFilter + FunnelStage types"
```

---

## Task 3: Wire `targetFilter` into `decideForUser` (TDD)

**Files:**
- Modify: `tests/integration/decide.test.ts`
- Modify: `src/lib/decide.ts`

- [ ] **Step 1: Update `tests/helpers/builders.ts` to accept targetFilter**

In `builders.ts`, update the `createAgent` overrides type (builders.ts must be updated before the test is written so TypeScript can compile the test):

```ts
export async function createAgent(overrides: {
  name?: string;
  algorithm?: string;
  epsilon?: number;
  status?: string;
  targetFilter?: Record<string, unknown> | null;
} = {}) {
  const { targetFilter, ...rest } = overrides;
  return prisma.agent.create({
    data: {
      name: "Test Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      status: "active",
      ...rest,
      ...(targetFilter !== undefined ? { targetFilter } : {}),
    },
  });
}
```

- [ ] **Step 2: Write failing integration tests**

Append to `tests/integration/decide.test.ts`:

```ts
  it("returns null when user attributes fail the agent's targetFilter", async () => {
    const persona = await createPersona();
    // User was just created — last_seen_days is ~0, so last_seen_days__gte: 30 fails
    const user = await createUser("usr_tf_exclude", { personaId: persona.id });
    const agent = await createAgent({ targetFilter: { last_seen_days__gte: 30 } });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: user.externalId }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(404);
  });

  it("returns a decision when user attributes pass the agent's targetFilter", async () => {
    const persona = await createPersona();
    // User was just created — last_seen_days is ~0, so last_seen_days__lte: 1 passes
    const user = await createUser("usr_tf_include", { personaId: persona.id });
    const agent = await createAgent({ targetFilter: { last_seen_days__lte: 1 } });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: user.externalId }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 3: Run the tests — verify they fail**

```bash
bun test tests/integration/decide.test.ts
```

Expected: The two new tests FAIL — `decideForUser` does not yet check `targetFilter`.

- [ ] **Step 4: Update `src/lib/decide.ts` with the targetFilter gate**

Add this import at the top of `src/lib/decide.ts`:

```ts
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
```

Then add step 3b immediately after the `if (!personaId) return null;` line (after persona fallback resolution):

```ts
  if (!personaId) return null; // no personas configured

  // 3b. targetFilter check — evaluate flat predicate against user attributes + computed keys.
  // Return null (same as "agent not found") to avoid leaking filter logic to callers.
  if (agent.targetFilter) {
    const computed = buildComputedKeys(user);
    const passes = evaluateTargetFilter(
      agent.targetFilter as Record<string, unknown>,
      { attributes: (user.attributes as Record<string, unknown>) ?? {}, computed }
    );
    if (!passes) return null;
  }
```

- [ ] **Step 5: Run the tests — verify they pass**

```bash
bun test tests/integration/decide.test.ts
```

Expected: All tests PASS, including the two new targetFilter cases.

- [ ] **Step 6: Run typecheck + lint**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/decide.ts tests/integration/decide.test.ts tests/helpers/builders.ts
git commit -m "feat(decide): add targetFilter gate in decideForUser"
```

---

## Task 4: Wire `targetFilter` into the cron route

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`

- [ ] **Step 1: Add the import**

Add to the imports at the top of `src/app/api/cron/select-and-send/route.ts`:

```ts
import { evaluateTargetFilter, buildComputedKeys } from "@/lib/engine/target-filter";
```

- [ ] **Step 2: Add the in-memory filter pass**

Find the block that declares `eligibleUsers` (after `freqCappedUserIds` and `smartSuppressedUserIds` filtering):

```ts
      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) => !freqCappedUserIds.has(u.externalId) && !smartSuppressedUserIds.has(u.externalId)
      );
```

Replace it with:

```ts
      // Filter to eligible users only (scheduling suppression + targetFilter)
      const eligibleUsers = users.filter((u) => {
        if (freqCappedUserIds.has(u.externalId) || smartSuppressedUserIds.has(u.externalId)) return false;
        if (!agent.targetFilter) return true;
        return evaluateTargetFilter(
          agent.targetFilter as Record<string, unknown>,
          {
            attributes: (u.attributes as Record<string, unknown>) ?? {},
            computed: buildComputedKeys(u),
          }
        );
      });
```

- [ ] **Step 3: Run typecheck + lint**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat(cron): apply targetFilter in-memory pass before decideForUser"
```

---

## Task 5: Agent CRUD API — `funnelStage` + `targetFilter` (TDD)

**Files:**
- Modify: `tests/integration/agents.test.ts`
- Modify: `src/app/api/agents/route.ts`
- Modify: `src/app/api/agents/[id]/route.ts`

- [ ] **Step 1: Write failing integration tests**

Append to `tests/integration/agents.test.ts`:

```ts
describe("POST /api/agents — funnelStage", () => {
  it("creates agent with valid funnelStage", async () => {
    const req = buildRequest("POST", {
      name: "Re-engagement",
      algorithm: "thompson",
      funnelStage: "lapsed",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.funnelStage).toBe("lapsed");
  });

  it("returns 400 when funnelStage is missing", async () => {
    const req = buildRequest("POST", {
      name: "No Stage",
      algorithm: "thompson",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("returns 400 when funnelStage is not a valid value", async () => {
    const req = buildRequest("POST", {
      name: "Bad Stage",
      algorithm: "thompson",
      funnelStage: "invalid_stage",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("creates agent with targetFilter", async () => {
    const req = buildRequest("POST", {
      name: "Filtered Agent",
      algorithm: "thompson",
      funnelStage: "connected",
      targetFilter: { last_seen_days__gte: 14 },
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.targetFilter).toEqual({ last_seen_days__gte: 14 });
  });
});

describe("PATCH /api/agents/[id] — funnelStage + targetFilter", () => {
  it("updates funnelStage", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Patch Me", algorithm: "thompson", epsilon: 0.1 },
    });
    const req = buildRequest("PATCH", { funnelStage: "inspired" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.funnelStage).toBe("inspired");
  });

  it("updates targetFilter", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Filter Me", algorithm: "thompson", epsilon: 0.1 },
    });
    const filter = { giver_tier__exists: true };
    const req = buildRequest("PATCH", { targetFilter: filter });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targetFilter).toEqual(filter);
  });

  it("returns 400 when funnelStage patch value is invalid", async () => {
    const agent = await prisma.agent.create({
      data: { name: "Bad Patch", algorithm: "thompson", epsilon: 0.1 },
    });
    const req = buildRequest("PATCH", { funnelStage: "bogus" });
    const res = await patchAgent(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });
});
```

Also update the existing `"creates an agent and returns 201"` test to include `funnelStage`:

```ts
describe("POST /api/agents", () => {
  it("creates an agent and returns 201", async () => {
    const req = buildRequest("POST", {
      name: "Test Campaign",
      algorithm: "thompson",
      epsilon: 0.1,
      funnelStage: "connected",
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.name).toBe("Test Campaign");
    expect(body.id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
bun test tests/integration/agents.test.ts
```

Expected: Several tests FAIL — the API does not yet validate or accept the new fields.

- [ ] **Step 3: Update `src/app/api/agents/route.ts`**

Add a validation constant before the `GET` function and update the `POST` handler:

```ts
const VALID_FUNNEL_STAGES = new Set(["new", "lapsed", "connected", "activated", "engaged", "inspired"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name, description, algorithm, epsilon,
      funnelStage,
      targetFilter,
      goals = [], messages = [],
      frequencyCap, quietStart, quietEnd, timezone,
      smartSuppress, suppressThresh,
    } = body;

    if (!funnelStage || !VALID_FUNNEL_STAGES.has(funnelStage)) {
      return NextResponse.json(
        { error: "funnelStage is required and must be one of: new, lapsed, connected, activated, engaged, inspired" },
        { status: 400 }
      );
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        description,
        algorithm: algorithm ?? "thompson",
        epsilon: epsilon ?? 0.1,
        status: "draft",
        funnelStage,
        targetFilter: targetFilter ?? undefined,
        goals: {
          create: goals.map((g: { eventName: string; tier: string; valueWeight: number; description?: string }) => ({
            eventName: g.eventName,
            tier: g.tier,
            valueWeight: g.valueWeight,
            description: g.description,
          })),
        },
        messages: {
          create: messages.map((m: {
            name: string;
            channel: string;
            variants?: Array<{
              name: string;
              subject?: string;
              body: string;
              cta?: string;
              title?: string;
              iconImageUrl?: string;
              deeplink?: string;
              preferredHour?: number;
              preferredDayOfWeek?: number;
              frequencyCapOverride?: string;
            }>;
          }) => {
            const variantList = m.variants ?? [];
            return {
              name: m.name,
              channel: m.channel,
              testedVariables: detectTestedVariables(variantList as MessageVariant[]),
              variants: {
                create: variantList.map((v) => ({
                  name: v.name ?? "V1",
                  subject: v.subject,
                  body: v.body,
                  cta: v.cta,
                  title: v.title,
                  iconImageUrl: v.iconImageUrl,
                  deeplink: v.deeplink,
                  preferredHour: v.preferredHour,
                  preferredDayOfWeek: v.preferredDayOfWeek,
                  frequencyCapOverride: v.frequencyCapOverride,
                })),
              },
            };
          }),
        },
        schedulingRule: {
          create: {
            frequencyCap: frequencyCap ?? { maxSends: 3, period: "week" },
            quietHours: {
              start: quietStart ?? "22:00",
              end: quietEnd ?? "08:00",
              timezone: timezone ?? "America/New_York",
            },
            smartSuppress: smartSuppress ?? false,
            suppressThresh: suppressThresh ?? 0.5,
          },
        },
      },
    });

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error("POST /api/agents error:", error);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Update `src/app/api/agents/[id]/route.ts`**

Update the `PATCH` handler to accept and validate `funnelStage` and `targetFilter`. Add the validation constant before the `GET` function:

```ts
const VALID_FUNNEL_STAGES = new Set(["new", "lapsed", "connected", "activated", "engaged", "inspired"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();

    if (body.funnelStage !== undefined && !VALID_FUNNEL_STAGES.has(body.funnelStage)) {
      return NextResponse.json(
        { error: "funnelStage must be one of: new, lapsed, connected, activated, engaged, inspired" },
        { status: 400 }
      );
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        status: body.status,
        algorithm: body.algorithm,
        epsilon: body.epsilon,
        ...(body.funnelStage !== undefined ? { funnelStage: body.funnelStage } : {}),
        ...(body.targetFilter !== undefined ? { targetFilter: body.targetFilter } : {}),
      },
    });
    return NextResponse.json(agent);
  } catch (error) {
    console.error(`PATCH /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the tests — verify they pass**

```bash
bun test tests/integration/agents.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Run full check**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/agents/route.ts src/app/api/agents/[id]/route.ts tests/integration/agents.test.ts
git commit -m "feat(api): add funnelStage + targetFilter to agent CRUD routes"
```

---

## Task 6: Agent card — stage badge

**Files:**
- Modify: `src/components/agents/agent-card.tsx`

- [ ] **Step 1: Add the stage badge**

Replace the full contents of `src/components/agents/agent-card.tsx` with:

```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Agent, FUNNEL_STAGE_META } from "@/types/agent";
import { AgentStatusBadge } from "./agent-status-badge";
import { formatNumber } from "@/lib/utils";
import { MessageSquare, Target, ArrowRight } from "lucide-react";

interface AgentCardProps {
  agent: Agent;
  conversionRate?: number;
}

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson Sampling",
  epsilon_greedy: "ε-Greedy",
  contextual: "Contextual Bandit",
};

export function AgentCard({ agent, conversionRate }: AgentCardProps) {
  const stageMeta = FUNNEL_STAGE_META[agent.funnelStage];

  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{agent.name}</p>
              {agent.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{agent.description}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <AgentStatusBadge status={agent.status} />
              <Badge variant="outline" className="text-xs whitespace-nowrap">
                {stageMeta.label}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {agent.goals?.length ?? 0} goals
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {agent.messages?.length ?? 0} messages
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Algorithm</p>
              <p className="text-xs font-medium">{algorithmLabels[agent.algorithm]}</p>
            </div>
            {agent._count && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Decisions</p>
                <p className="text-xs font-medium">{formatNumber(agent._count.decisions)}</p>
              </div>
            )}
            {conversionRate !== undefined && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Conv. Rate</p>
                <p className="text-sm font-bold text-primary">{conversionRate.toFixed(1)}%</p>
              </div>
            )}
          </div>

          <div className="flex items-center text-primary text-xs font-medium">
            <span>View details</span>
            <ArrowRight className="h-3 w-3 ml-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/agents/agent-card.tsx
git commit -m "feat(ui): add funnel stage badge to agent card"
```

---

## Task 7: Agent wizard — `funnelStage` selector

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`

- [ ] **Step 1: Add `funnelStage` to the wizard**

Add the import at the top of `agent-wizard.tsx`:

```ts
import { FUNNEL_STAGES, FUNNEL_STAGE_META, type FunnelStage } from "@/types/agent";
```

Add `funnelStage` to the `FormData` interface:

```ts
interface FormData {
  name: string;
  description: string;
  algorithm: string;
  epsilon: number;
  funnelStage: FunnelStage;
  targetPersonaIds: string[];
  goals: GoalDraft[];
  messages: MessageDraft[];
  frequencyCap: { maxSends: number; period: string };
  quietStart: string;
  quietEnd: string;
  timezone: string;
  smartSuppress: boolean;
  suppressThresh: number;
}
```

Update `defaultForm`:

```ts
const defaultForm: FormData = {
  name: "",
  description: "",
  algorithm: "thompson",
  epsilon: 0.1,
  funnelStage: "connected",
  targetPersonaIds: [],
  goals: [],
  messages: [],
  frequencyCap: { maxSends: 3, period: "week" },
  quietStart: "22:00",
  quietEnd: "08:00",
  timezone: "America/New_York",
  smartSuppress: false,
  suppressThresh: 0.5,
};
```

Inside the Step 1 JSX block (after the description `<Input>` and before the Algorithm `<Select>`), add the funnelStage selector:

```tsx
            <div>
              <label className="text-sm font-medium">Funnel Stage *</label>
              <p className="text-xs text-muted-foreground mb-2 mt-0.5">
                Who is this agent targeting? Pick the lifecycle stage that best describes their current state.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {FUNNEL_STAGES.map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => update("funnelStage", stage)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
                      form.funnelStage === stage
                        ? "border-primary bg-primary/5"
                        : "border-input hover:border-primary/40 hover:bg-muted/40"
                    )}
                  >
                    <span className="text-sm font-medium">{FUNNEL_STAGE_META[stage].label}</span>
                    <span className="text-xs text-muted-foreground">{FUNNEL_STAGE_META[stage].description}</span>
                  </button>
                ))}
              </div>
            </div>
```

Also update the "Next" button validation for step 1 to require `funnelStage`. Find the Next button in the wizard footer and add:

```tsx
disabled={step === 1 && !form.name.trim()}
```

(It already guards on name; `funnelStage` always has a default so no extra guard needed.)

- [ ] **Step 2: Run typecheck + lint**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/agents/agent-wizard.tsx
git commit -m "feat(ui): add funnelStage selector to agent creation wizard"
```

---

## Task 8: Agents list page — stage filter + real data

**Files:**
- Modify: `src/app/agents/page.tsx`

- [ ] **Step 1: Replace mock data with real API fetch and add stage filter**

Replace the full contents of `src/app/agents/page.tsx` with:

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Agent, AgentStatus, FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<AgentStatus | "all"> = ["all", "active", "paused", "draft"];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<FunnelStage | "all">("all");

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data: Agent[]) => setAgents(data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = agents.filter((a) => {
    const matchSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    const matchStage = stageFilter === "all" || a.funnelStage === stageFilter;
    return matchSearch && matchStatus && matchStage;
  });

  return (
    <>
      <Header title="Agents" description="Manage your Nexus agents" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents..."
                className="pl-8 w-64 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 border rounded-lg p-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {s === "all" ? "All" : <AgentStatusBadge status={s} />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 border rounded-lg p-1">
              <button
                onClick={() => setStageFilter("all")}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  stageFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                All stages
              </button>
              {FUNNEL_STAGES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStageFilter(stageFilter === s ? "all" : s)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                    stageFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {FUNNEL_STAGE_META[s].label}
                </button>
              ))}
            </div>
          </div>
          <Link href="/agents/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Agent
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">Loading agents...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No agents found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run typecheck + lint**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/agents/page.tsx
git commit -m "feat(ui): wire agents list to real API + add funnel stage filter"
```

---

## Task 9: Agent detail page — `funnelStage` badge + `targetFilter` display

**Files:**
- Modify: `src/app/agents/[id]/page.tsx`

- [ ] **Step 1: Add the import**

Add to the imports at the top of `src/app/agents/[id]/page.tsx`:

```ts
import { FUNNEL_STAGE_META, type FunnelStage } from "@/types/agent";
```

- [ ] **Step 2: Show funnelStage badge in the header area**

Find where `<AgentStatusBadge status={agent.status} />` is rendered (in the page's header/overview section) and add the stage badge alongside it:

```tsx
<AgentStatusBadge status={agent.status as AgentStatus} />
<Badge variant="outline" className="text-xs">
  {FUNNEL_STAGE_META[agent.funnelStage as FunnelStage].label}
</Badge>
```

- [ ] **Step 3: Add the targetFilter display**

In the agent detail page, find the overview tab content area (where algorithm, epsilon, etc. are shown) and add a targetFilter block after the existing config items:

```tsx
<div>
  <p className="text-xs font-medium text-muted-foreground mb-1">Target Filter</p>
  {agent.targetFilter ? (
    <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32 font-mono">
      {JSON.stringify(agent.targetFilter, null, 2)}
    </pre>
  ) : (
    <p className="text-xs text-muted-foreground italic">
      No filter — all persona-matched users are eligible
    </p>
  )}
</div>
```

- [ ] **Step 4: Run typecheck**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/agents/[id]/page.tsx
git commit -m "feat(ui): show funnelStage badge + targetFilter on agent detail page"
```

---

## Task 10: Settings cleanup — remove Braze and BigQuery cards

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Remove Braze state variables**

In `src/app/settings/page.tsx`, delete these `useState` declarations:

```ts
  const [showApiKey, setShowApiKey] = useState(false);
  const [brazeApiKey, setBrazeApiKey] = useState("");
  const [brazeRestUrl, setBrazeRestUrl] = useState("rest.iad-01.braze.com");
  const [brazeAndroidAppId, setBrazeAndroidAppId] = useState("");
  const [brazeIosAppId, setBrazeIosAppId] = useState("");
  const [brazeWebAppId, setBrazeWebAppId] = useState("");
  const [brazeAppGroupId, setBrazeAppGroupId] = useState("");

  // BigQuery config
  const [bqProjectId, setBqProjectId] = useState("");
  const [bqDataset, setBqDataset] = useState("");
  const [bqCredentialsPath, setBqCredentialsPath] = useState("");
```

- [ ] **Step 2: Update `handleSave` to only send the remaining settings**

Replace the `handleSave` function:

```ts
  const handleSave = async () => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_frequency_cap: String(defaultFreqCap),
        default_frequency_period: defaultPeriod,
        default_quiet_start: defaultQuietStart,
        default_quiet_end: defaultQuietEnd,
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };
```

- [ ] **Step 3: Remove the Braze and BigQuery Card JSX**

Delete the entire `{/* Braze */}` Card block (from `<Card>` to `</Card>` inclusive, lines ~88–148) and the entire `{/* BigQuery */}` Card block (lines ~150–190).

- [ ] **Step 4: Remove unused imports**

Remove `Eye`, `EyeOff`, and `Separator` from the import line:

```ts
import { CheckCircle2, Sparkles } from "lucide-react";
```

(Keep `CheckCircle2` and `Sparkles` — they're used by the save confirmation and persona discovery card.)

- [ ] **Step 5: Run typecheck + lint**

```bash
bun run check
```

Expected: No errors, no unused variable warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(ui): remove Braze and BigQuery config cards from settings"
```

---

## Task 11: Final integration check

- [ ] **Step 1: Run the full test suite**

```bash
bun run test
```

Expected: All unit and integration tests pass.

- [ ] **Step 2: Run the full check**

```bash
bun run check
```

Expected: No lint or type errors.

- [ ] **Step 3: Smoke test locally**

```bash
bun run dev
```

- Navigate to `/agents` — verify stage filter bar appears and filters work
- Navigate to `/agents/new` — verify funnel stage selector appears in step 1
- Create a test agent — verify it persists with the correct `funnelStage`
- Navigate to the agent detail page — verify stage badge and targetFilter section appear
- Navigate to `/settings` — verify Braze and BigQuery cards are gone

- [ ] **Step 4: Final commit if any stray changes remain**

```bash
git status  # confirm nothing untracked
```
