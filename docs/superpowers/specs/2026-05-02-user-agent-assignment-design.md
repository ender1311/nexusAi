# User-Agent Assignment: 8-Day Exploration Window Design

**Date:** 2026-05-02
**Status:** Approved for implementation
**Depends on:** `2026-05-02-agent-lottery-global-daily-cap-design.md` (must be implemented first)

---

## Goal

For non-daily users (funnel stages `lapsed` and `connected`), assign each user to a single agent for an 8-day exploration window. During the window, the cron sends up to 4 messages — timed to the user's behavioral peak — allowing the bandit to collect per-user signal on which content combination (copy, deeplink, image) converts best. After the window, the user re-enters the standard agent lottery. A configurable cooldown controls how long before a user is eligible for a new window.

---

## Problem

The current cron treats every active user the same: the lottery assigns them to an agent per-run, and the frequency cap controls send cadence. For daily active users (engaged, activated), this works well — signal accumulates quickly. For lapsed (>28 days inactive) and connected (MAU) users, signal is sparse. Without a focused exploration period, the bandit never learns the right day, time, and content combination for these users.

The desired model:
- First contact with a lapsed/connected user → 8-day window with 4 sends at their behavioral peak times
- Bandit learns which content (copy/deeplink/image) converts best across those 4 sends
- Time-of-day and day-of-week are anchored to the user's existing behavioral data, not explored blindly
- After the window, the user re-enters the standard lottery as a warmed-up user with established arm stats

---

## Variable Strategy (Option B)

Five variables were considered: day of week, time of day, copy, deeplink, and image asset.

**Copy, deeplink, and image** → handled by the existing content bandit. Each `MessageVariant` already encodes these as `body`/`title`, `deeplink`, and `iconImageUrl`. Thompson Sampling picks which arm to explore/exploit across the 4 sends.

**Day of week and time of day** → derived from the user's behavioral data (`dailyStats` and `hourlyStats` on `TrackedUser`), not explored from scratch. This avoids combinatorial explosion and leverages signal that already exists. Sends 1 and 3 target the user's primary peak; sends 2 and 4 target their secondary peak. Over multiple windows, the conversion events naturally refine the bandit's content preferences for each time slot.

---

## Architecture

### New DB model

```prisma
model UserAgentAssignment {
  id                String    @id @default(cuid())
  externalUserId    String    @unique  // one active record per user
  agentId           String
  startedAt         DateTime  @default(now())
  sendCount         Int       @default(0)
  windowCompletedAt DateTime?           // null = in exploration; non-null = window done

  @@index([agentId])
  @@index([windowCompletedAt])
}
```

**Cooldown configuration:** `AppSetting` key `exploration_window_cooldown_days`, value `"90"`. The cron reads this at runtime. Default 90 days if the key is missing.

**Re-assignment:** When a user's cooldown expires, their existing `UserAgentAssignment` record is overwritten via upsert (not appended). `UserDecision` already records every individual send; historical assignment records add no value.

---

### New pure engine function

**`src/lib/engine/send-timing.ts`**

```ts
/**
 * Returns the target send time for a user's Nth exploration send.
 *
 * sendIndex 0, 2 → primary peak (highest hour × highest day)
 * sendIndex 1, 3 → secondary peak (second-highest hour × second-highest day)
 *
 * Falls back to { hour: 9, dayOfWeek: 0 } (Sunday 9 AM ET) when stats are
 * all zero — covers new lapsed users with no prior behavioral data.
 */
export function computeSendTime(
  hourlyStats: number[],  // 24-element array from TrackedUser
  dailyStats: number[],   // 7-element array (0 = Sunday)
  sendIndex: number,      // 0–3
): { hour: number; dayOfWeek: number }
```

Pure function: no DB calls, no side effects. Ties are broken by taking the first (lowest-index) maximum.

---

### Modified cron: `src/app/api/cron/select-and-send/route.ts`

The cron gains **Phase 0: Assignment** before the existing lottery phase.

#### Phase 0: Assignment (new, runs once per cron invocation)

```
1. Read cooldownDays from AppSetting (key: exploration_window_cooldown_days; default 90)
2. Fetch all active agents where funnelStage IN (lapsed, connected)
   → collect their target personaIds (via AgentPersonaTarget)
   → fetch TrackedUsers where personaId IN (those personaIds)
   → left-join each user's UserAgentAssignment
3. Classify each user:
   A. No assignment record → newly eligible
   B. windowCompletedAt is null AND startedAt >= now - 8 days → IN WINDOW
   C. windowCompletedAt is null AND startedAt < now - 8 days
        → window expired without hitting 4 sends; mark windowCompletedAt = now, treat as D
   D. windowCompletedAt set AND windowCompletedAt < now - cooldownDays → newly eligible
   E. windowCompletedAt set AND cooldown not expired → skip (no window action)
4. For newly eligible users (A and D):
   - Find active lapsed/connected agents targeting the user's personaId
   - Pick one at random → create/upsert UserAgentAssignment
     { externalUserId, agentId, startedAt: now, sendCount: 0, windowCompletedAt: null }
5. Produce: inWindowMap: Map<externalUserId, agentId>  (users in class B)
```

#### Phase 1: Lottery (existing, modified)

Pass only users NOT in `inWindowMap` to `buildAgentLottery`. In-window users are pre-routed.

#### Phase 2: Per-agent loop (existing, modified)

Each agent now processes two user sub-pools:

**Sub-pool A — In-window users** (from `inWindowMap` filtered to this agent):
1. `sendCount < 4` check — skip user if budget exhausted (shouldn't happen; `windowCompletedAt` would be set)
2. Call `computeSendTime(user.hourlyStats, user.dailyStats, assignment.sendCount)`
3. Check: is current hour within ±1 of target hour AND current day matches target dayOfWeek? If not → skip this run (try again next cron tick)
4. Apply global daily cap (existing — safety net only, as user is locked to one agent)
5. Apply per-agent frequency cap, smart suppression, target filter (existing)
6. Run `decideForUser` for eligible users → Braze send (existing)
7. On successful send: increment `sendCount`; if `sendCount == 4` → set `windowCompletedAt = now()`

**Sub-pool B — Lottery users**: existing behavior unchanged.

---

## Data flow summary

```
Cron invoked
  │
  ├─ Phase 0: Assignment (new)
  │    ├─ Classify lapsed/connected users (no assignment / in-window / cooldown / eligible)
  │    ├─ Create/upsert assignments for newly eligible users
  │    └─ Produce inWindowMap
  │
  ├─ Phase 1: Lottery (modified)
  │    └─ excludes in-window users → lotteryMap
  │
  └─ Phase 2: Per-agent loop (modified)
       ├─ In-window users: timing check → daily cap → freq cap → decide → send → increment sendCount
       └─ Lottery users: existing pipeline unchanged
```

---

## What is NOT changed

- `/api/decide` — real-time decisions are unaffected
- `PersonaArmStats` / bandit learning — unchanged; in-window sends update arm stats normally
- `SchedulingRule` — per-agent frequency caps still apply to in-window users
- `MessageVariant` schema — no changes; copy/deeplink/image variables live on variants as today
- `UserDecision` schema — no changes; every send records `sentAt` as before

---

## New files

| File | Responsibility |
|---|---|
| `src/lib/engine/send-timing.ts` | `computeSendTime(hourlyStats, dailyStats, sendIndex)` — pure, no DB |

## Modified files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `UserAgentAssignment` model |
| `src/app/api/cron/select-and-send/route.ts` | Phase 0 assignment + in-window routing + send timing + budget tracking |

---

## Tests

### Unit: `src/lib/engine/send-timing.ts`
- Returns peak hour and peak day for sendIndex 0
- Returns secondary peak hour and day for sendIndex 1
- sendIndex 2 returns same result as sendIndex 0 (primary peak)
- sendIndex 3 returns same result as sendIndex 1 (secondary peak)
- Falls back to `{ hour: 9, dayOfWeek: 0 }` when both arrays are all zeros
- Handles ties by returning the first (lowest-index) maximum

### Integration: extend `tests/integration/cron-send.test.ts`
- Lapsed user with no assignment: assignment record created on first cron run, user locked to assigned agent
- In-window user at peak time: send goes out, `sendCount` increments
- In-window user NOT at peak time: send skipped (no `UserDecision` created), `sendCount` unchanged
- After 4 sends: `windowCompletedAt` is set; user re-enters lottery on next run
- Window reaches 8 days without 4 sends: `windowCompletedAt` set on day 8 regardless of sendCount
- Cooldown not expired: user gets no new window despite being lapsed/connected
- Cooldown expired: assignment record overwritten, new window starts
- Connected user: same treatment as lapsed — gets exploration window

---

## Sequencing note

This feature depends on the agent lottery and global daily cap (`select-and-send` Phase 0 lottery, `buildAgentLottery`, `getTodayStartUTC`) being implemented first. The exploration window's Phase 0 runs before the lottery phase and feeds into it.
