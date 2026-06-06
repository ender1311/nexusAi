# Temporary Pause + Kill Switch — Design Spec

**Date:** 2026-06-06
**Status:** Approved (design)

## Goal

Add a **temporary, fully reversible** way to stop an agent from sending messages —
per-agent and globally ("kill switch") — without disrupting any bandit learning,
cohort state, or in-flight user journeys. Surface synced toggles on the agent
cards, the agent detail page, and the Control Tower, plus two global kill
switches. Show a success notification on every pause/resume.

## Core principle — why this preserves learning

A pause is a **gate on sending only**. It must never trigger the cohort-release
path in `PATCH /api/agents/[id]` (`src/app/api/agents/[id]/route.ts:130-149`),
which releases `trackedUser.lockedByAgentId`, releases `userAgentAssignment`
rows, and clears `cohortAssignedAt`. The pause leaves untouched:

- `trackedUser.lockedByAgentId` (cohort stays locked to the paused agent)
- `userAgentAssignment` rows (in-flight journeys + exploration windows frozen)
- `Agent.cohortAssignedAt`
- All bandit state: `PersonaArmStats`, `UserArmStats`, `LinUCBArm`

A paused agent is **frozen**. Fleet-wide exclusivity keeps its users reserved, so
no other agent claims them during the pause. On resume the cron continues exactly
where it left off.

## Data model

### 1. `Agent.sendingPaused Boolean @default(false)`

Per-agent pause flag, **orthogonal** to `status` (`active` / `draft` / `paused`).
- `status` keeps its current meaning (launched vs. not; the existing
  active↔draft toggle and the cohort-resetting `paused` status are unchanged).
- `sendingPaused` only tells the cron "skip sending for this agent."

**Migration (prod-safe, idempotent):**
```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sendingPaused" BOOLEAN NOT NULL DEFAULT false;
```
Create the Prisma migration folder, apply the idempotent DDL to **both** the prod
DB (`DATABASE_URL_UNPOOLED`) and the local `nexus_test` DB, then
`npx prisma migrate resolve --applied <migration_name>` to reconcile history
WITHOUT running `migrate dev` (which would attempt a destructive reset against
prod). Regenerate the Prisma client.

### 2. `AppSetting` key `global_sending_paused`

Kill switch. Value is the string `"true"` or `"false"` (AppSetting.value is
`String`). Absent key ⇒ treated as `"false"`. Same key/value store already used
for `push_targeting_mode`, the cron lock, etc.

## Cron changes — `src/app/api/cron/select-and-send/route.ts`

### Kill switch — early short-circuit
After the Braze-config check and before loading agents (~line 110), read the
`global_sending_paused` AppSetting. If `=== "true"`:
- Mark the in-progress `cronRun` row finished with a clear note
  (`status: "completed"`, an `errorMsg`/note like `"skipped — global kill switch on"`
  or a dedicated field if cleaner — do NOT mark it `failed`).
- Return `NextResponse.json({ paused: true, sent: 0 })` with status 200.
- Nothing is loaded, sent, or released.

### Per-agent pause — query filter
Change the active-agent query (`route.ts:110-111`):
```ts
where: { status: "active", sendingPaused: false }
```
Paused agents drop out of the send loop with cohort/locks/assignments intact.
No other cron logic changes.

## API changes

### Per-agent — extend `PATCH /api/agents/[id]`
`src/app/api/agents/[id]/route.ts`:
- Validate: `if (body.sendingPaused !== undefined && typeof body.sendingPaused !== "boolean") return fail("Invalid sendingPaused", 400);`
- Add `...(body.sendingPaused !== undefined ? { sendingPaused: body.sendingPaused } : {})` to the `prisma.agent.update` data.
- **Must NOT** be added to the `releasesCohort` predicate (`route.ts:134-139`).
  Toggling pause never resets the cohort. (Regression-test this guarantee.)
- Existing `revalidatePath`/`revalidateTag` calls already cover `/agents`,
  `agent-${id}`, and `agents`.

### Kill switch — reuse `POST /api/settings`
Writes: `POST /api/settings` with `{ global_sending_paused: "true" | "false" }`
(already admin-gated, upserts AppSetting).
Reads: the page reads it server-side (direct `prisma.appSetting.findUnique`
or the existing settings map). Add a small cached helper if convenient, but a
direct read in the Server Component is acceptable.

## UI surfaces — 4 synced toggle types

**Sync mechanism:** every per-agent toggle PATCHes `sendingPaused` then calls
`router.refresh()`; both kill switches POST the AppSetting then `router.refresh()`.
All toggles read the same server-rendered source of truth, so a refresh after any
mutation re-derives every toggle's state — they cannot drift.

### A. Agent card — `src/components/agents/agent-card.tsx`
- New Pause/Resume button (admin-only), styled like the existing delete control
  area. Pause icon when sending, Play icon when paused.
- `onClick` stops propagation (card is wrapped in a `<Link>`).
- PATCH `{ sendingPaused }`, `router.refresh()`, `toast.success("\"<name>\" paused" | "resumed")`,
  `toast.error(...)` on failure.
- Requires threading `isAdmin` from the Agents page → `AgentGrid` → `AgentCard`,
  and `sendingPaused` onto the serialized agent shape + `Agent` TS type
  (`src/types/agent.ts`).
- When the global kill switch is on, show a subtle "kill switch on" hint; the
  button stays enabled (per-agent state is still editable underneath).

### B. Agent detail page — `src/app/agents/[id]/page.tsx`
- Render a pause-sending toggle beside the existing
  `<AgentStatusToggle agentId status />` (admin-only block). Reuse a shared
  `AgentPauseToggle` client component (also used by the card) for consistency.

### C. Control Tower per-agent — repoint existing grid
`src/components/control-tower/agent-toggle-grid.tsx` + `agent-toggle-card.tsx`:
- `enabled = status === "active" && !sendingPaused`.
- Toggle OFF → PATCH `{ sendingPaused: true }` (pause). Toggle ON → PATCH `{ sendingPaused: false }` (resume).
- **Drop the destructive confirmation dialog** — pause is non-destructive and reversible.
- Add `sendingPaused` to `SerializedAgent` and thread it from
  `getCachedControlTowerAgents` (`src/lib/cache.ts`) — verify the cached query
  selects `sendingPaused`.
- Update the InfoTip copy: "Pausing stops sends immediately and freezes the
  agent's cohort and learning; resume continues exactly where it left off."
  (now literally true). Notification messages say "paused"/"resumed".

### D. Two kill switches
A shared `KillSwitchToggle` client component bound to `global_sending_paused`:
- POST `/api/settings { global_sending_paused }`, `router.refresh()`,
  `toast.success("Kill switch ON — all sending paused" | "Kill switch OFF — sending resumed")`.
- Placement 1: Agents page header (`src/app/agents/page.tsx`), admin-only, reads
  current value server-side and passes as prop.
- Placement 2: Control Tower (`src/app/control-tower/page.tsx`), e.g. in the
  stats bar / agent-grid header, admin-only.
- Visually prominent / destructive styling; confirm dialog ON for turning the
  kill switch **on** (fleet-wide effect), no confirm to turn it off.

## Edge cases / behavior notes

- **Kill switch is a layer, not a mutation of per-agent state.** It does not
  overwrite each agent's `sendingPaused`. Turning it off restores each agent to
  its own prior pause state (correct resume). Effective "is sending" =
  `status === "active" && !agent.sendingPaused && global_sending_paused !== "true"`.
- A `draft` agent's `sendingPaused` is moot until launched (cron still requires
  `status: "active"`). Documented, not specially handled.
- Auth: all mutations 403 for non-admins (PATCH and settings POST already call
  `requireAdmin()`); toggles render admin-only.

## Tests

**Regression (`tests/regression/`):**
- `agent-pause-preserves-cohort`: create agent, materialize cohort
  (`cohortAssignedAt`, `lockedByAgentId`, an open `userAgentAssignment`, arm
  stats); PATCH `{ sendingPaused: true }`; assert locks, assignment
  (`releasedAt` still null), `cohortAssignedAt`, and arm-stats rows are ALL
  unchanged. Comment links to this spec. This guards the core guarantee.

**Integration (`tests/integration/`):**
- PATCH `sendingPaused` true/false round-trips; does not touch cohort fields.
- Cron excludes agents with `sendingPaused: true` from the send loop while
  including active, unpaused agents.
- Cron short-circuits (sends 0, no releases) when `global_sending_paused` is
  `"true"`; resumes normally when toggled back to `"false"`.
- Settings POST/GET round-trips `global_sending_paused`.

**Contract/unit:** validation rejects non-boolean `sendingPaused` with 400.

Use `tests/helpers/builders.ts` factories. `createAgent` overrides must accept
`sendingPaused?: boolean`.

## Out of scope

- Scheduling / auto-resume timers (pure manual toggle for now).
- Changing the meaning of `status` or the existing active↔draft toggle.
- Per-channel or per-variant pausing.
