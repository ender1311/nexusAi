# Nexus — Agent Targeting Predicate: Implementation Spec

**Status:** Ready for implementation  
**Last updated:** 2026-05-01  
**Scope:** Schema change, migration, cron update, API updates, UI hints

---

## Overview

This spec adds **user-level targeting predicates** to agents so that Hightouch-synced `TrackedUser.attributes` can filter eligibility at cron/decide time — not just at persona assignment time.

The mental model being encoded:

```
Agent       = funnel stage + intent       (what you want the user to do)
Persona     = response archetype          (how they respond to content — learned by bandit)
targetFilter = eligibility predicate      (who is eligible for this agent right now, from Hightouch)
```

**Before this change:** an agent fires for every user in its target personas.  
**After this change:** an agent fires only for users in its target personas AND whose `attributes` pass the `targetFilter`.

---

## 1 — Schema Change: Add `targetFilter` to `Agent`

### 1a. Prisma model update

**File:** `prisma/schema.prisma`

Add one field to the `Agent` model:

```prisma
model Agent {
  id          String   @id @default(cuid())
  name        String
  description String?
  status      String   @default("draft")   // draft | active | paused
  algorithm   String   @default("thompson") // thompson | epsilon_greedy | contextual
  epsilon     Float    @default(0.1)
  targetFilter Json?   // NEW — eligibility predicate evaluated against TrackedUser.attributes
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  goals            Goal[]
  messages         Message[]
  decisions        UserDecision[]
  metrics          ModelMetric[]
  schedulingRule   SchedulingRule?
  personaTargets   AgentPersonaTarget[]
}
```

`targetFilter` is nullable (`Json?`). A null value means "no filter — all users in target personas are eligible." This is the default and preserves all existing behavior.

### 1b. Create the Prisma migration

```bash
npx prisma migrate dev --name add_agent_target_filter
```

This generates a migration file in `prisma/migrations/`. The SQL will be:

```sql
ALTER TABLE "Agent" ADD COLUMN "targetFilter" JSONB;
```

No backfill needed — existing agents get `null`, which means "no filter" (fully backward compatible).

---

## 2 — targetFilter JSON Schema

The `targetFilter` is a flat JSON object. Each key is an attribute path on `TrackedUser.attributes`; the value is the condition. All conditions are AND-ed together.

### 2a. Supported operators

| Operator key suffix | Type | Meaning | Example |
|---|---|---|---|
| *(bare key)* | scalar | exact equality | `{ "preferred_channel_30d": "push" }` |
| `__gte` | number | ≥ | `{ "last_seen_days__gte": 7 }` |
| `__lte` | number | ≤ | `{ "last_seen_days__lte": 90 }` |
| `__gt` | number | > | `{ "gifts_count_3_36mo__gt": 0 }` |
| `__lt` | number | < | `{ "streak_depth__lt": 3 }` |
| `__eq` | any | explicit equality | `{ "has_recurring_gift__eq": false }` |
| `__neq` | any | not equal | `{ "source_application__neq": "web" }` |
| `__exists` | boolean | key present and non-null | `{ "last_seen_at__exists": true }` |
| `__in` | array | value in list | `{ "language_tag__in": ["en", "es"] }` |

### 2b. Special computed keys

These are **not** raw attribute fields — they are computed by the filter evaluator at runtime from `TrackedUser` fields:

| Key | Source | Type | Notes |
|---|---|---|---|
| `last_seen_days` | `TrackedUser.attributes.last_seen_at` (ISO string) | number | Days since last_seen_at. Computed as `Math.floor((now - Date.parse(last_seen_at)) / 86400000)`. If `last_seen_at` is missing, evaluates as `Infinity`. |
| `total_decisions` | `TrackedUser.totalDecisions` | number | Total sends received across all agents. |
| `total_conversions` | `TrackedUser.totalConversions` | number | Total conversions across all agents. |
| `persona_confidence` | `TrackedUser.personaConfidence` | number | 0–1 confidence of current persona assignment. |

### 2c. Example targetFilter values

**Re-engagement agent** — users who haven't opened the app in 7+ days:
```json
{ "last_seen_days__gte": 7 }
```

**Habit reinforcement agent** — active users with a streak, not lapsed:
```json
{ "last_seen_days__lte": 3, "streak_depth__gt": 0 }
```

**Giving activation agent** — non-donors who have shown engagement:
```json
{ "has_recurring_gift__eq": false, "gifts_count_3_36mo__eq": 0, "last_seen_days__lte": 14 }
```

**Deep conversion / plan depth agent** — users mid-plan:
```json
{ "plan_depth__gte": 3, "last_seen_days__lte": 7 }
```

**Lapsing plan user** — users in a plan but going cold:
```json
{ "plan_depth__gte": 1, "last_seen_days__gte": 5, "last_seen_days__lte": 21 }
```

**English push-enabled users only:**
```json
{ "language_tag__in": ["en", "en-US", "en-GB"], "preferred_channel_30d": "push" }
```

---

## 3 — Filter Evaluator: `src/lib/engine/target-filter.ts`

Create this file. It is a pure function — no DB calls, no side effects.

```typescript
// src/lib/engine/target-filter.ts

export type TargetFilter = Record<string, unknown>

/**
 * Evaluates a targetFilter predicate against a TrackedUser's attributes
 * and computed fields. Returns true if the user passes all conditions.
 *
 * Called in:
 *   - src/app/api/cron/select-and-send/route.ts  (bulk pre-filter before decideForUser)
 *   - src/lib/decide.ts                           (guard inside decideForUser)
 *
 * @param filter  - Agent.targetFilter JSON (null/undefined = no filter = always passes)
 * @param user    - TrackedUser record (full object with attributes, stats, etc.)
 */
export function evaluateTargetFilter(
  filter: TargetFilter | null | undefined,
  user: {
    attributes: Record<string, unknown> | null
    totalDecisions: number
    totalConversions: number
    personaConfidence: number | null
  }
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true

  const attrs = (user.attributes ?? {}) as Record<string, unknown>

  // Build the lookup context: raw attributes + computed keys
  const ctx: Record<string, unknown> = {
    ...attrs,
    total_decisions: user.totalDecisions,
    total_conversions: user.totalConversions,
    persona_confidence: user.personaConfidence ?? 0,
    // Compute last_seen_days from last_seen_at attribute
    last_seen_days: computeLastSeenDays(attrs['last_seen_at']),
  }

  for (const [rawKey, condition] of Object.entries(filter)) {
    if (!evaluateCondition(rawKey, condition, ctx)) return false
  }

  return true
}

function computeLastSeenDays(lastSeenAt: unknown): number {
  if (typeof lastSeenAt !== 'string' || !lastSeenAt) return Infinity
  const ts = Date.parse(lastSeenAt)
  if (isNaN(ts)) return Infinity
  return Math.floor((Date.now() - ts) / 86_400_000)
}

function evaluateCondition(
  rawKey: string,
  condition: unknown,
  ctx: Record<string, unknown>
): boolean {
  // Parse operator suffix
  const operators = ['__gte', '__lte', '__gt', '__lt', '__eq', '__neq', '__exists', '__in'] as const
  type Operator = typeof operators[number]

  let key = rawKey
  let op: Operator | null = null

  for (const suffix of operators) {
    if (rawKey.endsWith(suffix)) {
      key = rawKey.slice(0, -suffix.length)
      op = suffix
      break
    }
  }

  const value = ctx[key]

  switch (op) {
    case null:
    case '__eq':
      // Loose equality for booleans from Hightouch (may arrive as 0/1/false/true/"false")
      return looseEqual(value, condition)
    case '__neq':
      return !looseEqual(value, condition)
    case '__gte':
      return typeof value === 'number' && typeof condition === 'number' && value >= condition
    case '__lte':
      return typeof value === 'number' && typeof condition === 'number' && value <= condition
    case '__gt':
      return typeof value === 'number' && typeof condition === 'number' && value > condition
    case '__lt':
      return typeof value === 'number' && typeof condition === 'number' && value < condition
    case '__exists':
      return condition === true ? value !== null && value !== undefined : value === null || value === undefined
    case '__in':
      return Array.isArray(condition) && condition.some(c => looseEqual(value, c))
    default:
      return false
  }
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Coerce boolean-like Hightouch strings/numbers
  const normalize = (v: unknown): unknown => {
    if (v === 'true' || v === 1) return true
    if (v === 'false' || v === 0) return false
    return v
  }
  return normalize(a) === normalize(b)
}
```

### Unit tests: `tests/unit/target-filter.test.ts`

```typescript
import { describe, expect, it } from 'bun:test'
import { evaluateTargetFilter } from '../../src/lib/engine/target-filter'

const baseUser = {
  attributes: {
    last_seen_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), // 10 days ago
    has_recurring_gift: false,
    preferred_channel_30d: 'push',
    language_tag: 'en',
    gifts_count_3_36mo: 0,
    streak_depth: 5,
    plan_depth: 3,
  },
  totalDecisions: 12,
  totalConversions: 2,
  personaConfidence: 0.85,
}

describe('evaluateTargetFilter', () => {
  it('returns true when filter is null', () => {
    expect(evaluateTargetFilter(null, baseUser)).toBe(true)
  })

  it('returns true when filter is empty object', () => {
    expect(evaluateTargetFilter({}, baseUser)).toBe(true)
  })

  it('passes last_seen_days__gte check', () => {
    expect(evaluateTargetFilter({ last_seen_days__gte: 7 }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ last_seen_days__gte: 15 }, baseUser)).toBe(false)
  })

  it('passes last_seen_days__lte check', () => {
    expect(evaluateTargetFilter({ last_seen_days__lte: 14 }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ last_seen_days__lte: 5 }, baseUser)).toBe(false)
  })

  it('handles missing last_seen_at as Infinity', () => {
    const user = { ...baseUser, attributes: { ...baseUser.attributes, last_seen_at: undefined } }
    expect(evaluateTargetFilter({ last_seen_days__gte: 999 }, user as any)).toBe(true)
    expect(evaluateTargetFilter({ last_seen_days__lte: 999 }, user as any)).toBe(false)
  })

  it('passes exact equality (bare key)', () => {
    expect(evaluateTargetFilter({ preferred_channel_30d: 'push' }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ preferred_channel_30d: 'email' }, baseUser)).toBe(false)
  })

  it('passes __eq with boolean coercion', () => {
    expect(evaluateTargetFilter({ has_recurring_gift__eq: false }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ has_recurring_gift__eq: true }, baseUser)).toBe(false)
  })

  it('passes __in check', () => {
    expect(evaluateTargetFilter({ language_tag__in: ['en', 'es'] }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ language_tag__in: ['fr', 'de'] }, baseUser)).toBe(false)
  })

  it('passes __gt and __lt checks', () => {
    expect(evaluateTargetFilter({ streak_depth__gt: 0 }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ streak_depth__gt: 5 }, baseUser)).toBe(false)
    expect(evaluateTargetFilter({ gifts_count_3_36mo__lt: 1 }, baseUser)).toBe(true)
  })

  it('AND-s all conditions', () => {
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 7, has_recurring_gift__eq: false },
      baseUser
    )).toBe(true)
    expect(evaluateTargetFilter(
      { last_seen_days__gte: 7, has_recurring_gift__eq: true }, // second condition fails
      baseUser
    )).toBe(false)
  })

  it('uses computed total_decisions', () => {
    expect(evaluateTargetFilter({ total_decisions__gte: 10 }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ total_decisions__gte: 20 }, baseUser)).toBe(false)
  })

  it('passes __exists check', () => {
    expect(evaluateTargetFilter({ last_seen_at__exists: true }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ nonexistent_field__exists: false }, baseUser)).toBe(true)
    expect(evaluateTargetFilter({ nonexistent_field__exists: true }, baseUser)).toBe(false)
  })
})
```

---

## 4 — `decideForUser`: add targetFilter guard

**File:** `src/lib/decide.ts`

Import and call `evaluateTargetFilter` near the top of `decideForUser`, after the persona is resolved but before any bandit logic or `UserDecision` is written.

```typescript
// Add to imports at top of file
import { evaluateTargetFilter } from './engine/target-filter'

// Inside decideForUser(), after agent and user are loaded, before bandit selection:

// --- TARGET FILTER CHECK ---
if (agent.targetFilter) {
  const passes = evaluateTargetFilter(
    agent.targetFilter as Record<string, unknown>,
    {
      attributes: user.attributes as Record<string, unknown> | null,
      totalDecisions: user.totalDecisions,
      totalConversions: user.totalConversions,
      personaConfidence: user.personaConfidence,
    }
  )
  if (!passes) {
    return { suppressed: true, reason: 'target_filter_mismatch' }
  }
}
// --- END TARGET FILTER CHECK ---
```

This guard runs even when `skipSchedulingChecks: true` (cron path) because the cron does its own bulk pre-filter (see Section 5) and `decideForUser` is the safety net for edge cases.

---

## 5 — Cron: bulk pre-filter before decideForUser

**File:** `src/app/api/cron/select-and-send/route.ts`

The cron currently cursor-paginates users, does bulk scheduling checks, then calls `decideForUser` per user. Add a `targetFilter` pre-filter step in the per-page processing loop **before** the `decideForUser` calls. This avoids wasting concurrency slots on ineligible users.

### Where to add it

In the per-page loop, after the existing bulk frequency-cap/suppression filter and before the `decideForUser` concurrent batch:

```typescript
import { evaluateTargetFilter } from '@/lib/engine/target-filter'

// Inside the per-page processing block, after bulk suppression filter:

// --- BULK TARGET FILTER ---
const targetFilterPassed = schedulingPassed.filter(user =>
  evaluateTargetFilter(
    agent.targetFilter as Record<string, unknown> | null,
    {
      attributes: user.attributes as Record<string, unknown> | null,
      totalDecisions: user.totalDecisions,
      totalConversions: user.totalConversions,
      personaConfidence: user.personaConfidence,
    }
  )
)

const targetFilteredOut = schedulingPassed.length - targetFilterPassed.length
suppressedCount += targetFilteredOut
// (log targetFilteredOut for observability)

// Then use targetFilterPassed instead of schedulingPassed in the decideForUser batch
// --- END BULK TARGET FILTER ---
```

**Variable naming assumption:** adjust `schedulingPassed` to whatever the current variable name is for the users who passed scheduling checks in your cron. The logic is: filter that array down to only users who pass `targetFilter`, accumulate the rest into `suppressedCount`.

### Observability: log the filter stats per agent

After processing each agent's page batch, log:

```typescript
console.log(`[cron] agent=${agent.id} page=${pageNum} eligible=${targetFilterPassed.length} targetFiltered=${targetFilteredOut}`)
```

---

## 6 — API: expose targetFilter in agent CRUD

### 6a. `POST /api/agents` — accept targetFilter on create

**File:** `src/app/api/agents/route.ts`

The request body already accepts a free-form agent shape. Add `targetFilter` to the Zod schema (or type assertion, depending on current validation approach):

```typescript
// In the request body schema/type:
targetFilter?: Record<string, unknown> | null
```

When inserting the agent into the DB:

```typescript
await prisma.agent.create({
  data: {
    name,
    description,
    algorithm,
    epsilon,
    targetFilter: body.targetFilter ?? null,  // ADD THIS
    // ...rest of fields
  }
})
```

### 6b. `PATCH /api/agents/:id` — accept targetFilter on update

**File:** `src/app/api/agents/[id]/route.ts`

In the PATCH handler, add `targetFilter` to the allowed update fields:

```typescript
const { name, description, status, algorithm, epsilon, targetFilter } = body

await prisma.agent.update({
  where: { id: params.id },
  data: {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(status !== undefined && { status }),
    ...(algorithm !== undefined && { algorithm }),
    ...(epsilon !== undefined && { epsilon }),
    ...(targetFilter !== undefined && { targetFilter }),  // ADD THIS
  }
})
```

### 6c. `GET /api/agents` and `GET /api/agents/:id` — include targetFilter in response

`targetFilter` is a Prisma field on the `Agent` model. It will be returned automatically in all Prisma `findMany` / `findUnique` calls that return the full agent object. No change needed unless you have explicit `select` clauses that omit it — in that case, add `targetFilter: true` to each select.

---

## 7 — TypeScript types

**File:** `src/types/index.ts` (or wherever agent types are defined)

Add `targetFilter` to the `Agent` type:

```typescript
export interface Agent {
  id: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'paused'
  algorithm: 'thompson' | 'epsilon_greedy' | 'contextual'
  epsilon: number
  targetFilter: TargetFilter | null   // ADD THIS
  createdAt: Date
  updatedAt: Date
  // ... relations
}

export type TargetFilter = Record<string, unknown>
```

If you use Prisma-generated types directly (from `@prisma/client`), the type will be `Prisma.JsonValue | null` — that's fine. You can cast to `Record<string, unknown>` when passing to `evaluateTargetFilter`.

---

## 8 — Agent configuration: canonical agents to create

These are the four initial agents to configure in the system. Create them via the UI or via a seed script. Each maps to a funnel stage. Personas are assigned separately via `AgentPersonaTarget` after k-means discovery runs and personas are named.

### Agent 1: Re-engagement

```json
{
  "name": "Re-engagement",
  "description": "Bring lapsed users back to daily Bible reading. Fires for users who haven't opened the app in 7+ days.",
  "algorithm": "thompson",
  "status": "active",
  "targetFilter": {
    "last_seen_days__gte": 7
  },
  "goals": [
    { "eventName": "bible_opened",   "tier": "good",      "valueWeight": 1.0 },
    { "eventName": "plan_started",   "tier": "very_good", "valueWeight": 1.0 },
    { "eventName": "plan_completed", "tier": "best",      "valueWeight": 1.0 },
    { "eventName": "push_disabled",  "tier": "worst",     "valueWeight": 1.0 }
  ],
  "messages": [
    {
      "name": "Re-engagement Push",
      "channel": "push",
      "variants": [
        {
          "name": "Variant A — Consistency",
          "title": "Growth is not about perfection…",
          "body": "It's about consistency ➡️",
          "deeplink": "youversion://bible"
        },
        {
          "name": "Variant B — VOTD",
          "title": "👂 Listen to God today",
          "body": "Reflect on the Verse of the Day ➡️",
          "deeplink": "youversion://bible"
        },
        {
          "name": "Variant C — Guided Prayer",
          "title": "⏸️ Pause with God",
          "body": "Spend time with God in Guided Prayer.",
          "deeplink": "https://www.bible.com/guides/1"
        },
        {
          "name": "Variant D — Personalized",
          "title": "{{${first_name} | default: \"friend\"}}, what's your next step?",
          "body": "Open your Bible App today!",
          "deeplink": "youversion://bible"
        }
      ]
    }
  ]
}
```

**Persona targets:** All 8 personas (no user is exempt from re-engagement). The `targetFilter` restricts to lapsed users; personas determine which variant wins per behavioral cluster.

---

### Agent 2: Habit Reinforcement

```json
{
  "name": "Habit Reinforcement",
  "description": "Reinforce active users mid-streak. Fires for users seen in the last 3 days with an active streak.",
  "algorithm": "thompson",
  "status": "active",
  "targetFilter": {
    "last_seen_days__lte": 3,
    "streak_depth__gt": 0
  },
  "goals": [
    { "eventName": "bible_opened",    "tier": "good",      "valueWeight": 1.0 },
    { "eventName": "plan_read_day_3", "tier": "very_good", "valueWeight": 1.0 },
    { "eventName": "plan_read_day_7", "tier": "best",      "valueWeight": 1.0 },
    { "eventName": "push_disabled",   "tier": "worst",     "valueWeight": 1.0 }
  ],
  "messages": [
    {
      "name": "Habit Push",
      "channel": "push",
      "variants": [
        {
          "name": "Variant A — Momentum",
          "title": "Who do you want to be?",
          "body": "Here's what happens when you spend time with God ➡️",
          "deeplink": "youversion://bible"
        },
        {
          "name": "Variant B — Streak Pride",
          "title": "You're on a roll, {{${first_name} | default: \"friend\"}}.",
          "body": "Keep your streak going today.",
          "deeplink": "youversion://bible"
        },
        {
          "name": "Variant C — Next Plan",
          "title": "Congrats! You completed a Plan!",
          "body": "Choose another Plan and keep your momentum going.",
          "deeplink": "https://www.bible.com/reading-plans"
        }
      ]
    }
  ]
}
```

**Persona targets:** High-engagement personas (Regular, Daily archetypes). Do not target Lapsed personas — the `targetFilter` would filter them anyway, but keeping the persona target tight reduces wasted DB scans.

---

### Agent 3: Depth Conversion (Plan Activation)

```json
{
  "name": "Depth Conversion",
  "description": "Move mid-plan users toward plan completion. Fires for users with plan_depth >= 3 who are still active.",
  "algorithm": "thompson",
  "status": "active",
  "targetFilter": {
    "plan_depth__gte": 3,
    "last_seen_days__lte": 14
  },
  "goals": [
    { "eventName": "plan_read_day_3",  "tier": "good",      "valueWeight": 1.0 },
    { "eventName": "plan_read_day_7",  "tier": "very_good", "valueWeight": 1.0 },
    { "eventName": "plan_completed",   "tier": "best",      "valueWeight": 1.0 },
    { "eventName": "push_disabled",    "tier": "worst",     "valueWeight": 1.0 }
  ],
  "messages": [
    {
      "name": "Plan Depth Push",
      "channel": "push",
      "variants": [
        {
          "name": "Variant A — Continue Plan",
          "title": "Pick up where you left off",
          "body": "Your reading plan is waiting.",
          "deeplink": "https://www.bible.com/my-plans"
        },
        {
          "name": "Variant B — Encourage Progress",
          "title": "You're making real progress.",
          "body": "Keep going — open your plan today.",
          "deeplink": "https://www.bible.com/my-plans"
        },
        {
          "name": "Variant C — Scripture Pull",
          "title": "Today's reading is ready",
          "body": "Open your Bible App and dive in.",
          "deeplink": "youversion://bible"
        }
      ]
    }
  ]
}
```

**Persona targets:** Plan-engaged personas. Overlap with Habit Reinforcement is acceptable — the `targetFilter` conditions distinguish users. If a user passes both agents' filters, the cron fires both (standard behavior, subject to frequency cap). Tune `SchedulingRule.frequencyCap` to `{ maxSends: 1, period: "day" }` per agent to prevent double-sending.

---

### Agent 4: Giving Activation

```json
{
  "name": "Giving Activation",
  "description": "Activate non-donors who are engaged. Fires for users with no prior giving history who are recently active.",
  "algorithm": "thompson",
  "status": "draft",
  "targetFilter": {
    "has_recurring_gift__eq": false,
    "gifts_count_3_36mo__eq": 0,
    "last_seen_days__lte": 14
  },
  "goals": [
    { "eventName": "giving_page_opened", "tier": "good",      "valueWeight": 1.0 },
    { "eventName": "gave",               "tier": "best",      "valueWeight": 1.0 },
    { "eventName": "push_disabled",      "tier": "worst",     "valueWeight": 1.0 }
  ],
  "messages": [
    {
      "name": "Giving Push",
      "channel": "push",
      "variants": [
        {
          "name": "Variant A — Impact",
          "title": "Your generosity changes lives.",
          "body": "Give to YouVersion today.",
          "deeplink": "https://www.bible.com/give"
        },
        {
          "name": "Variant B — Community",
          "title": "Join millions who give.",
          "body": "Support free Bible access for everyone.",
          "deeplink": "https://www.bible.com/give"
        },
        {
          "name": "Variant C — Monthly",
          "title": "Make a lasting difference.",
          "body": "Start a monthly gift to YouVersion.",
          "deeplink": "https://www.bible.com/give?frequency=monthly"
        }
      ]
    }
  ]
}
```

**Status is `draft` intentionally.** Activate after re-engagement and habit agents are stable and arm stats have accumulated. Giving conversion requires longer learning windows.

**Persona targets:** High-LTV and Donor-Likely personas once discovered. Until personas are named from k-means output, do not activate.

---

## 9 — Scheduling rules per agent

Set via `POST /api/agents/:id/scheduling-rule` (or directly in DB for now). These are strongly recommended before any agent goes active:

| Agent | frequencyCap | quietHours | smartSuppress |
|---|---|---|---|
| Re-engagement | `{ maxSends: 2, period: "week" }` | `{ start: 21, end: 8, timezone: "user" }` | true, thresh: 0.1 |
| Habit Reinforcement | `{ maxSends: 1, period: "day" }` | `{ start: 21, end: 7, timezone: "user" }` | true, thresh: 0.15 |
| Depth Conversion | `{ maxSends: 1, period: "day" }` | `{ start: 21, end: 7, timezone: "user" }` | true, thresh: 0.1 |
| Giving Activation | `{ maxSends: 1, period: "week" }` | `{ start: 21, end: 8, timezone: "user" }` | true, thresh: 0.2 |

`timezone: "user"` is a placeholder indicating the quiet hours should be applied in the user's local timezone using their `language_tag` or Braze's `in_local_time: true` flag. Implement this as a follow-up if not already present.

---

## 10 — Hightouch: attributes required for targetFilter

The following `TrackedUser.attributes` keys are referenced by the targetFilters above. All must be present in the Hightouch → `/api/ingest/users` sync payload. Cross-reference with `json/hightouch-ingest-users-payload.json`.

| Attribute key | Source column | Type | Notes |
|---|---|---|---|
| `last_seen_at` | `last_seen_timestamp` | ISO string | Already mapped ✅ |
| `has_recurring_gift` | `Has Active Recurring Gift to the YouVersion Fund` | boolean | Already mapped ✅ |
| `gifts_count_3_36mo` | `Gifts Given within the past 3 to 36 Months` | number | Already mapped ✅ |
| `preferred_channel_30d` | `Preferred Channel Overall 30 Days` | string | Already mapped ✅ |
| `language_tag` | `language_tag` | string | Already mapped ✅ |
| `streak_depth` | *(not yet mapped)* | number | **Add to Hightouch sync** — user's current streak length in days |
| `plan_depth` | *(not yet mapped)* | number | **Add to Hightouch sync** — number of plan days completed in active plan |

### Add to Hightouch Liquid template (`json/hightouch-ingest-users-payload.json`)

In the `attributes` object, add:

```json
"streak_depth": {{ row['streak_depth'] | default: 0 }},
"plan_depth": {{ row['plan_depth'] | default: 0 }},
```

And add the corresponding column mappings in `hightouch-sync-config.md`:

| Hightouch column | Payload field |
|---|---|
| `streak_depth` (or warehouse equivalent) | `attributes.streak_depth` |
| `plan_depth` (or warehouse equivalent) | `attributes.plan_depth` |

Confirm exact column names with the data warehouse team. These likely exist as traits in Hightouch already.

---

## 11 — UI: targetFilter editor (agent form)

This is a post-launch nice-to-have but included here so agents know the intended UX.

**Location:** Agent create/edit form, below the "Algorithm" section, above "Goals".

**Component:** A simple key-value pair editor. Each row has:
- Key input (text) — with a dropdown hint showing known attribute keys
- Operator dropdown: `=`, `≠`, `≥`, `≤`, `>`, `<`, `in`, `exists`
- Value input (text/number/array)

**Display in agent list:** Show a "Targeting" badge on agent cards when `targetFilter` is non-null, with a tooltip summarizing the filter conditions in plain English.

**Plain English renderer** (for tooltips and dashboard):

```typescript
function renderFilterSummary(filter: TargetFilter): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries(filter)) {
    if (key === 'last_seen_days__gte') parts.push(`lapsed ≥ ${val}d`)
    else if (key === 'last_seen_days__lte') parts.push(`active ≤ ${val}d`)
    else if (key === 'has_recurring_gift__eq') parts.push(val ? 'recurring donor' : 'non-donor')
    else if (key === 'streak_depth__gt') parts.push(`streak > ${val}`)
    else if (key === 'plan_depth__gte') parts.push(`plan depth ≥ ${val}`)
    else parts.push(`${key}: ${JSON.stringify(val)}`)
  }
  return parts.join(' · ')
}
```

---

## 12 — Migration & deployment order

Execute in this exact order to avoid downtime or broken cron runs:

1. **Merge schema change** — `prisma/schema.prisma` + migration file. Deploy to production. `targetFilter` is nullable; existing agents get `null`; cron behavior unchanged.

2. **Deploy `target-filter.ts`** — pure function, no DB dependency. Safe to deploy before it's called.

3. **Deploy `decide.ts` update** — adds the guard. With `targetFilter = null` on all existing agents, `evaluateTargetFilter(null, user)` returns `true` immediately. Zero behavior change.

4. **Deploy cron update** — adds bulk pre-filter. Same: `null` filter → `filter(() => true)` → no change.

5. **Deploy API updates** — PATCH/POST accept `targetFilter`. Safe at any point.

6. **Create agents** (Section 8) — set `targetFilter` on each. Start with Re-engagement agent only. Verify cron logs show `targetFiltered=N` for ineligible users.

7. **Add `streak_depth` and `plan_depth` to Hightouch sync** — coordinate with data team. These attributes must be populated before Habit Reinforcement and Depth Conversion agents go active.

8. **Activate Habit Reinforcement** — after step 7 is confirmed and Re-engagement has been running for ≥ 1 week.

9. **Activate Depth Conversion** — after step 7. Can run concurrently with step 8.

10. **Activate Giving** — after Re-engagement has been running ≥ 2 weeks and arm stats are meaningful. Giving conversion is lower-frequency; needs more runway.

---

## 13 — Acceptance criteria

Before each agent goes active, verify:

- [ ] `targetFilter` field present in `GET /api/agents/:id` response
- [ ] `PATCH /api/agents/:id` with `{ "targetFilter": { "last_seen_days__gte": 7 } }` succeeds and persists
- [ ] `evaluateTargetFilter` unit tests all pass (`bun run test tests/unit/target-filter.test.ts`)
- [ ] Cron dry run logs show `targetFiltered=N` for users who fail the filter
- [ ] `decideForUser` returns `{ suppressed: true, reason: "target_filter_mismatch" }` for a user who fails the filter
- [ ] Cron does NOT write `UserDecision` records for filtered-out users
- [ ] Braze receives no sends for filtered-out users
- [ ] Existing agents with `targetFilter: null` show zero behavior change

---

## 14 — Update `brain.md`

Add to the **Architectural Decisions** table:

| Decision | Rationale | Date |
|---|---|---|
| `Agent.targetFilter` JSON predicate | Hightouch attributes filter eligibility at cron time; agent = funnel stage, persona = response archetype, targetFilter = who is eligible now | 2026-05-01 |
| Agents organized by funnel stage | A single agent serving both lapsed and daily users produces noisy arm stats; funnel-stage agents keep reward signal clean | 2026-05-01 |
| `last_seen_days` computed at filter time | Avoids storing a stale computed field; always reflects current time relative to `last_seen_at` | 2026-05-01 |

Add to **What's Been Built** (once implemented):

```
### Agent targeting
- ✅ Agent.targetFilter JSON predicate (Prisma field + migration)
- ✅ evaluateTargetFilter() pure function (src/lib/engine/target-filter.ts)
- ✅ targetFilter guard in decideForUser()
- ✅ Bulk pre-filter in cron select-and-send
- ✅ PATCH /api/agents/:id accepts targetFilter
- ✅ Four funnel-stage agents created (Re-engagement, Habit, Depth, Giving)
```

Add to **Open Questions** (to resolve):

- **What are the exact Hightouch column names for `streak_depth` and `plan_depth`?** Confirm with data warehouse team before activating Habit Reinforcement and Depth Conversion agents.
- **What is the actual push CTR per funnel stage?** Re-engagement users likely have lower CTR than habit users. Each agent's `Beta(1,30)` prior may need tuning per-agent once initial data arrives.
