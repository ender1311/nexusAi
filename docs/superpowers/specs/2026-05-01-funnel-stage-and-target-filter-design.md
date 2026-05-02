# Funnel Stage + Agent Targeting Predicate — Design Spec
**Date:** 2026-05-01
**Branch:** feature/algo-upgrades-and-persona-migration
**Status:** Approved — ready for implementation

---

## Overview

Two additive changes to the Agent model that sharpen who each agent fires for:

1. **`funnelStage`** — every agent is assigned to one of 6 lifecycle stages. Describes the intent of the agent (what you want the user to do / where they are in the funnel).
2. **`targetFilter`** — an optional flat JSON predicate evaluated against `TrackedUser.attributes` and computed keys. Agents only fire for users whose attributes pass the predicate.

Mental model: `Funnel Stage → Agent (goal)` · `Persona → variant wins (arm stats)` · `targetFilter → eligibility gate`

---

## Section 1 — Schema

One Prisma migration adds two fields to `Agent`:

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
  // ... existing fields unchanged ...
  funnelStage  FunnelStage @default(connected)
  targetFilter Json?       // null = no filter, match all users
}
```

`funnelStage` defaults to `connected` — existing agents are not broken.
`targetFilter` is nullable — null means the filter is not applied (fully backwards-compatible).

### Funnel Stage Metadata

Stored as a TypeScript constant in `src/lib/engine/types.ts` — not in the DB:

```ts
export const FUNNEL_STAGE_META: Record<FunnelStage, { label: string; description: string }> = {
  new:       { label: "New",       description: "First installed < 28 days ago" },
  lapsed:    { label: "Lapsed",    description: "Last app use > 28 days ago" },
  connected: { label: "Connected", description: "MAU — monthly active users" },
  activated: { label: "Activated", description: "WAU — weekly/daily active users" },
  engaged:   { label: "Engaged",   description: "DEU — active 4+ days/week" },
  inspired:  { label: "Inspired",  description: "Givers & evangelists" },
};
```

UI uses `FUNNEL_STAGE_META[agent.funnelStage].label` for badges and `.description` for tooltips.

---

## Section 2 — Engine: `evaluateTargetFilter()`

New pure function at `src/lib/engine/target-filter.ts`. No DB calls, no side effects.

### Operators

Applied as key suffixes in the predicate object:

| Suffix | Meaning |
|---|---|
| `__gte`, `__lte`, `__gt`, `__lt` | Numeric comparison |
| `__eq`, `__neq` | Equality / inequality |
| `__exists` | Field presence (`true` = must exist, `false` = must not exist) |
| `__in` | Value must be in the provided array |
| *(no suffix)* | Shorthand for `__eq` |

All conditions are AND-ed. An empty predicate `{}` matches every user.

### Computed Keys

Derived at evaluation time from the user record — not stored in `attributes`:

| Key | Source |
|---|---|
| `last_seen_days` | Days since `TrackedUser.updatedAt` |
| `total_decisions` | `TrackedUser.totalDecisions` |
| `total_conversions` | `TrackedUser.totalConversions` |
| `persona_confidence` | `TrackedUser.personaConfidence` |

### Signature

```ts
type ComputedUserKeys = {
  last_seen_days: number;
  total_decisions: number;
  total_conversions: number;
  persona_confidence: number;
};

function evaluateTargetFilter(
  filter: Record<string, unknown>,
  user: {
    attributes: Record<string, unknown>;
    computed: ComputedUserKeys;
  }
): boolean
```

Helper `buildComputedKeys(user: TrackedUser): ComputedUserKeys` lives in the same file.

### Example Predicates

```json
// Re-engagement: lapsed users with at least some prior engagement
{ "last_seen_days__gte": 28, "total_decisions__gte": 1 }

// Giving activation: users with giver_tier set
{ "giver_tier__exists": true }

// Engaged readers: streak active, high confidence
{ "streak_status__eq": "active", "persona_confidence__gte": 0.6 }
```

---

## Section 3 — API & `decide.ts` changes

### `decideForUser()` — new step 3b

After persona resolution (existing step 3), before variant selection (step 5):

```ts
// 3b. targetFilter check — bail before variant selection
if (agent.targetFilter) {
  const computed = buildComputedKeys(user);
  const passes = evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
    attributes: user.attributes as Record<string, unknown>,
    computed,
  });
  if (!passes) return null;
}
```

`null` return = caller treats as "no eligible agent" (existing behaviour for inactive agents).

### Cron route — in-memory targetFilter pass

After the existing freq-cap + smart-suppress filter, before `decideForUser`:

```ts
const targetFiltered = eligibleUsers.filter((u) => {
  if (!agent.targetFilter) return true;
  return evaluateTargetFilter(agent.targetFilter as Record<string, unknown>, {
    attributes: u.attributes as Record<string, unknown>,
    computed: buildComputedKeys(u),
  });
});
```

The cron route's existing Postgres query (`WHERE personaId IN (...)`) is unchanged — `targetFilter` is applied in-memory on the already-loaded page. This is correct for V1; SQL-side JSON filtering is premature optimisation at current scale.

### Agent CRUD routes

- `POST /api/agents` — accepts `funnelStage` (required string; 400 if missing or not one of the 6 enum values) and `targetFilter` (optional object)
- `PATCH /api/agents/[id]` — accepts both fields
- `GET /api/agents` / `GET /api/agents/[id]` — return both fields automatically (Prisma includes new columns without code change)

`funnelStage` validation at the API boundary:

```ts
const VALID_STAGES = new Set(["new","lapsed","connected","activated","engaged","inspired"]);
if (!VALID_STAGES.has(body.funnelStage)) {
  return NextResponse.json({ error: "Invalid funnelStage" }, { status: 400 });
}
```

---

## Section 4 — UI changes

### Agent creation wizard
- `funnelStage` is a required field — new step in the wizard
- Rendered as a segmented control or `<Select>` showing all 6 stages with label + description from `FUNNEL_STAGE_META`
- Cannot advance without selecting a stage

### Agent cards / list view
- Each agent card shows a stage badge: `Connected · MAU`
- Agents list page gets a filter bar — click a stage chip to filter; click again to clear
- Multi-select not needed for V1

### Agent detail / edit page
- `funnelStage` shown and editable via `<Select>`
- `targetFilter` shown as a read-only JSON code block when set; empty state shows "No filter — all persona-matched users are eligible"
- "Edit filter" opens a `<Textarea>` with the raw JSON; validated on save — must parse as valid JSON and be a plain object (not array/null); invalid JSON shows an inline error and blocks save

### No changes in this PR
Performance, Control Tower, Personas — follow-on work.

---

## Section 5 — Testing

### Unit tests — `tests/unit/target-filter.test.ts`
- Each operator: `__gte`, `__lte`, `__gt`, `__lt`, `__eq`, `__neq`, `__exists`, `__in`
- Computed keys: all four keys resolve correctly from a mock `TrackedUser`
- Edge cases: empty predicate matches all users, unknown attribute key returns false, null filter is not evaluated
- AND logic: all conditions must pass for a true return

### Integration test updates
- `tests/integration/decide.test.ts`
  - Agent with `targetFilter` that matches user → returns a decision
  - Agent with `targetFilter` that excludes user → returns null
- `tests/integration/agents.test.ts` (new or expand)
  - `POST /api/agents` with valid `funnelStage` + `targetFilter` round-trips correctly
  - `POST /api/agents` with invalid `funnelStage` → 400
  - `PATCH /api/agents/[id]` updates both fields

---

## Section 6 — Settings cleanup

Remove the **Braze Configuration** card and **BigQuery Configuration** card from the `/settings` UI page.

- Credentials are managed via environment variables / Vercel dashboard — no need to expose them in the app UI
- The `AppSetting` DB table and `/api/settings` route remain untouched (still used by `createBrazeClient()` internally)
- Only the UI surface is removed

---

## Out of scope (V1)

- Visual targetFilter query builder (V1 = raw JSON textarea)
- SQL-side JSON filtering in the cron route
- Automatic stage inference from user attributes
- Stage-level analytics / funnel conversion metrics
- Seeding the 4 canonical agents from the spec
