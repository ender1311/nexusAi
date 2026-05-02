# Agent Lottery + Global Daily Cap Design

**Date:** 2026-05-02
**Status:** Approved for implementation

---

## Goal

Prevent a single user from receiving more than one push notification per calendar day across all agents, while distributing users fairly across agents that share an eligible user pool.

## Problem

The `select-and-send` cron loops over all active agents independently. If Agent A and Agent B both target the same persona, a user in that persona is processed by both agents in the same cron run. Both agents apply their own per-agent frequency cap but there is no cross-agent guard. A user can receive N pushes in one cron run — one per agent that targets them.

The desired model for multi-agent campaigns (e.g., 3 agents on the `connected` funnel stage, each with different goals and in-app destinations) is:

- Each user receives at most one push per calendar day across all agents.
- Users eligible for multiple agents are distributed across those agents — no single agent claims all shared users.

---

## Architecture

### Two new pure engine functions

**`src/lib/engine/scheduling.ts`**

```ts
/**
 * Returns the start of the current calendar day (midnight) in the given
 * IANA timezone, expressed as a UTC Date.
 *
 * Example: at 14:00 UTC on 2026-05-02, getTodayStartUTC("America/New_York")
 * returns 2026-05-02T04:00:00.000Z (midnight ET = 04:00 UTC in EDT).
 */
export function getTodayStartUTC(timezone: string): Date
```

Uses `Intl.DateTimeFormat` to determine the UTC offset for midnight in the given timezone. Handles DST transitions correctly because it derives the offset from the actual current date, not a fixed offset.

**`src/lib/engine/agent-lottery.ts`**

```ts
/**
 * Assigns each eligible user to exactly one agent for a single cron run.
 *
 * For users eligible for only one agent: assigned to that agent.
 * For users eligible for multiple agents: randomly assigned to one agent,
 * producing an approximately uniform distribution across agents.
 *
 * Returns a Map<externalUserId, agentId>.
 * Users not in any agent's eligible pool are not in the map.
 */
export function buildAgentLottery(
  eligibleUsersByAgent: Map<string, string[]>  // agentId → externalUserIds
): Map<string, string>                          // externalUserId → agentId
```

Pure function: no DB calls, no side effects. Input is a map of agentId to that agent's eligible userIds (pre-fetched). Output is the assignment map for the run.

**Distribution algorithm:** For each user, collect all agents that want them, then pick one via `Math.floor(Math.random() * candidates.length)`. Users exclusive to one agent are assigned without randomisation. This produces ~1/N distribution for N agents sharing the same pool.

---

### Modified cron: `src/app/api/cron/select-and-send/route.ts`

The cron gains a **pre-assignment phase** before the existing agent loop, and a **global daily cap** inside the per-agent user batch loop.

#### Phase 0: Pre-assignment (new, runs once per cron invocation)

```
1. Fetch all active agents (existing query — unchanged)
2. For each agent, fetch eligible userIds:
     SELECT externalId FROM TrackedUser
     WHERE personaId IN (agent.personaIds)
   This is a lightweight read — IDs only, no full user objects.
3. Call buildAgentLottery(eligibleUsersByAgent)
   → lotteryMap: Map<externalUserId, agentId>
```

The lottery map is computed once and held in memory for the duration of the cron run.

#### Phase 1: Per-agent loop (modified)

The existing agent loop is preserved. Two changes are introduced:

**Change 1 — User pagination filtered by lottery assignment.**
When paginating `TrackedUser` for an agent, add a WHERE clause:
```
WHERE personaId IN (agent.personaIds)
AND   externalId IN (usersAssignedToThisAgent)
```
`usersAssignedToThisAgent` is derived from `lotteryMap` by filtering for entries where `value === agent.id`.

For agents with large user pools (>500), pagination continues as before. The lottery filter is applied as an additional `externalId IN (...)` clause on each page query. Since the lottery pre-fetches all eligible IDs, the set is known upfront.

**Change 2 — Global daily cap check (new bulk query per page).**
After the existing bulk frequency-cap query, add:

```ts
const todayStart = getTodayStartUTC("America/New_York");
const sentTodayRows = await prisma.userDecision.findMany({
  where: {
    userId: { in: userExternalIds },
    sentAt: { gte: todayStart },
    // intentionally no agentId filter — cross-agent
  },
  select: { userId: true },
  distinct: ["userId"],
});
const sentTodayIds = new Set(sentTodayRows.map(r => r.userId));
```

Users in `sentTodayIds` are counted as suppressed and excluded from further processing for this agent. This acts as a safety net for:
- Manual cron re-runs (cron triggered twice in one day)
- Partial cron failures where some agents ran in a previous attempt
- Edge cases where a user's persona was updated mid-run and they appear in two agents' pools

#### Suppression accounting

The existing `totalSuppressed` counter is incremented for global-daily-capped users. The cron response already returns `{ ok, sent, suppressed, errors }` — no new response fields needed.

---

## Data flow summary

```
Cron invoked
  │
  ├─ Fetch active agents
  ├─ For each agent: fetch eligible userIds (IDs only)
  ├─ buildAgentLottery → lotteryMap
  │
  └─ For each agent (existing loop):
       ├─ Skip if quiet hours (existing)
       ├─ Pre-seed PersonaArmStats (existing)
       └─ Paginate users WHERE assigned to this agent in lotteryMap
            ├─ Global daily cap: exclude users with sentAt >= midnight ET (new)
            ├─ Per-agent frequency cap (existing)
            ├─ Smart suppression (existing)
            ├─ Target filter (existing)
            └─ decideForUser + Braze send (existing)
```

---

## What is NOT changed

- `/api/decide` — real-time contextual decisions are unaffected. The global daily cap applies only to batch cron sends.
- `UserDecision` schema — no new columns. The global cap queries the existing `sentAt` field.
- `SchedulingRule` — per-agent frequency caps are preserved and still apply after the global cap filter.
- `PersonaArmStats` — bandit learning is unaffected. All arm stats update normally on conversion events regardless of which agent sent.

---

## New files

| File | Responsibility |
|---|---|
| `src/lib/engine/scheduling.ts` | `getTodayStartUTC(timezone)` — pure, no DB |
| `src/lib/engine/agent-lottery.ts` | `buildAgentLottery(eligibleUsersByAgent)` — pure, no DB |

## Modified files

| File | Change |
|---|---|
| `src/app/api/cron/select-and-send/route.ts` | Pre-assignment phase + lottery filter on user query + global daily cap |

---

## Tests

### Unit: `src/lib/engine/scheduling.ts`
- Returns correct UTC date for midnight ET on a standard day
- Returns correct UTC date across DST spring-forward (ET UTC-5 → UTC-4)
- Returns correct UTC date across DST fall-back (ET UTC-4 → UTC-5)
- Handles midnight UTC edge case (a call at 00:30 UTC = prior evening ET)

### Unit: `src/lib/engine/agent-lottery.ts`
- Single agent: all users assigned to that agent
- Two agents, disjoint pools: each user assigned to their only eligible agent
- Two agents, fully shared pool: each user assigned to exactly one agent, no user appears twice
- Three agents, fully shared pool: distribution is approximately uniform (no user in >1 agent)
- Empty pool: returns empty map
- One agent with no users: other agent gets all shared users

### Integration: `tests/integration/cron-send.test.ts`
- Two active agents targeting same persona: after one cron run, each user appears in exactly one agent's `UserDecision` records (zero users sent by both)
- One agent targeting persona A, one agent targeting persona B (disjoint): both agents send normally, no cross-suppression
- Cron run triggered twice in same calendar day: second run sends to zero users (global daily cap blocks all)
- User sent by Agent A on day 1: on day 2 (after midnight ET), user is eligible again

---

## Agent ordering and fairness

Within a single cron run, agents are processed in Prisma's default return order (`orderBy: { updatedAt: "desc" }`). The lottery pre-assignment decouples distribution fairness from processing order — by the time the loop starts, each user is already committed to exactly one agent. Processing order affects nothing.

Over multiple cron runs, `Math.random()` produces different assignments each day. No single agent permanently dominates the shared user pool.

---

## Timezone note

`America/New_York` is hardcoded as the daily cap timezone. This matches the YouVersion primary operating timezone and the existing quiet hours default. It is not configurable per-agent — the global cap is a system-level guardrail, not an agent-level scheduling rule.
