# Agent cohort assignment — product intent & engineering handoff

**Audience:** Implementing agent (or engineer)  
**Status:** Desired behavior vs current production (Neo / Morpheus investigation, Jun 2026)  
**Related:** `docs/send-timing-architecture.md`, `docs/nexus-agent-targeting-spec.md`, `src/app/api/cron/select-and-send/route.ts`

---

## Product intent (what Dan wants)

When creating an agent with **Unique users cap = N** (e.g. 1,000):

1. **Assign N users at creation time** — pick the cohort up front from eligible `TrackedUser` rows (persona + funnel/segment + language + consent), not drip-discover them over weeks of cron.
2. **Start experimenting on that full cohort immediately** — bandit sends / exploration should begin for all assigned users without waiting for incremental lottery wins, low `audienceCap`, or Morpheus-style lock accumulation on a sibling agent.

The wizard label (“max lifetime unique users”) is currently read as a **ceiling enforced during cron**. Dan’s intent is closer to **“this is my experiment cohort size — materialize it when I create the agent.”**

---

## What production does today (verified on Neo & Morpheus)

### Config confusion: cap ≠ assigned

| Field | Neo (prod) | Meaning today |
|-------|------------|----------------|
| `uniqueUsersCap` | 1,000 | **Max distinct users** the agent may ever get a `UserDecision` for — not “already assigned 1,000” |
| Card “Unique users” | ~117 / 1.0K (12%) | `COUNT(DISTINCT userId)` on `UserDecision` — **actual reach**, not cap |
| `audienceCap` | **100** | Max users considered **per hourly cron run** (binding for Neo) |
| `dailySendCap` | 500 | Max **confirmed Braze sends per UTC day** — Neo ~6/day, not binding |
| `lockedByAgentId` | 32 (Neo), 1,012 (Morpheus) | Users lottery-won and locked over time — **not** 1,000 at create |

**There is no API or job that pre-assigns `uniqueUsersCap` users when `POST /agents` completes.**

### How users enter an agent today (hourly cron)

```
Eligible pool (persona × funnelStage/segment × filters)
  → buildAgentLottery() — random one agent per user when multiple agents overlap
  → audienceCap trim (Neo: 100/run)
  → dailySendCap trim (confirmed sends today)
  → uniqueUsersCap trim (1000 − COUNT DISTINCT UserDecision already)
  → lock lottery winners (lockedByAgentId)
  → per-user: freq cap, global daily cap, quiet hours, timing window, channel/lang filters
  → Braze send + UserDecision
```

### Why Neo looks “stuck” at ~118 users despite 1,000 cap

- **Not** because `uniqueUsersCap` was exhausted (only ~12% used).
- **Because:** `audienceCap = 100`/hour, shares **Word-driven + lapsed_wau** with Morpheus (lottery + locks), and only ~118 users have ever received a `UserDecision`.
- **Daily cap 500 is not binding**; low sends are pipeline/supply/competition, not the 500 ceiling.

### Why Morpheus volume collapsed after Jun 1–3 burst

- **Not** daily cap (0–2/day recently with 1000 headroom).
- **Rolling 7-day freq cap** (`maxSends: 3`, `period: week`) — ~237/1,012 locked users still at ≥3 Morpheus sends in window shortly after burst; slots reopen **staggered** as each send ages out (not calendar-week reset).
- **Plus:** same-hour **timing gate** (preferred send within 2h), **global 1 push/user/day across all agents**, locks not cleared on release (only on agent pause/delete).
- Phase 0 **exploration windows** only run for agents with `funnelStage === "lapsed" | "connected"` — **not** `lapsed_wau` / `lapsed_dau4`, so Neo/Morpheus do **not** get the 8-day / 4-send exploration path in code today.

### Overlap (competition)

- Neo and Morpheus: same persona (**Word-driven**), same `funnelStage` (**lapsed_wau**), no segment split.
- ~5.3M eligible `TrackedUser` rows in that slice; lottery + locks determine who each agent keeps.
- 52 users have `UserDecision` rows from **both** agents historically.

---

## Gap analysis: intent vs implementation

| Desired | Current |
|---------|---------|
| Assign N users at agent create | No cohort materialization; cap enforced incrementally in cron |
| Experiment on full cohort immediately | `audienceCap` throttles per hour; lottery splits overlapping agents; timing/freq/global caps delay sends |
| Unique users cap = cohort size | Cap = lifetime DISTINCT decisions counter |
| Clear ownership of cohort | `lockedByAgentId` only on lottery win; locks persist until agent paused/deleted |
| Immediate exploration | `classifyExplorationWindows` skips `lapsed_wau` / `lapsed_dau4` agents |

---

## Recommended implementation directions

Pick one primary model and align UI copy with it.

### Option A — Cohort assignment at create (best match to intent)

On `POST /agents` (or async job right after):

1. Resolve eligible `externalId`s (same filters as cron pre-assignment).
2. Sample or deterministically select **N = `uniqueUsersCap`** (respect fleet exclusivity: skip users with active `UserAgentAssignment` / `lockedByAgentId` owned by another agent).
3. Persist cohort:
   - `UserAgentAssignment` rows (`startedAt = now`, `sendCount = 0`) and/or
   - `TrackedUser.lockedByAgentId = agent.id` for cohort members.
4. Optional: store `Agent.cohortAssignedAt` + `Agent.cohortSize` for UI.

Cron changes:

- **Skip lottery** for users already in this agent’s cohort table / lock set.
- Process **cohort members first** each run until `dailySendCap`; relax or remove **`audienceCap`** for cohort agents (or set `audienceCap >= uniqueUsersCap`).
- Extend Phase 0 (or equivalent) to **`lapsed_wau` / `lapsed_dau4`** if product wants 4-send exploration windows.

### Option B — Keep incremental cron, fix UX + knobs (smaller change)

- Rename wizard: “Unique users cap” → “**Target cohort size**” with helper: “Users are added over time as cron runs; not all assigned at once.”
- Neo-like fixes without schema change: `audienceCap: null` or ≥ cohort size; **dedicated persona or segment** so agents don’t share lottery with Morpheus.
- Document that 1,000 cap ≠ 1,000 assigned until decisions exist.

### Option C — Segment-based static cohort

- Require `targetSegmentName` or `segmentTargeting.includes` with exactly N members in `UserSegment`.
- Agent only targets that segment; assignment = segment membership sync from Hightouch.

---

## Acceptance criteria (for “assign N, experiment immediately”)

1. Within T minutes of agent create (or explicit “Assign cohort” action), DB shows **N distinct users** linked to agent (assignments and/or locks), queryable in admin UI.
2. Within 24h, **>0 sends** attempting for cohort members (subject to freq/global caps), not capped to **100 users/hour** unless intentional.
3. UI shows **Assigned: N / Cap: N** separately from **Sent / Opened** metrics.
4. Two agents on same funnel without segment split **cannot** silently steal each other’s cohort (document or enforce exclusivity at assign time).
5. Tests: integration test `POST /agents` with `uniqueUsersCap: 50` → 50 assignments; cron processes them before random lottery pool.

---

## Key files

| Area | Path |
|------|------|
| Cron orchestration | `src/app/api/cron/select-and-send/route.ts` |
| Caps | `src/lib/cron/caps.ts` (`audienceCap`, `trimToCap`, `uniqueUsersCap`) |
| Lottery | `src/lib/engine/agent-lottery.ts` |
| Exploration (lapsed/connected only) | `src/lib/cron/exploration-window.ts` |
| Agent create | `src/app/api/agents/route.ts`, `src/components/agents/agent-wizard.tsx` |
| Card metrics | `src/lib/cache/agents.ts` (`getCachedAgentCardStats`) |
| Prod trace script | `scripts/trace-agent-send-gates.ts` |

---

## Immediate ops tweaks (no code — Neo/Morpheus)

Until cohort-at-create ships:

- Neo: raise **`audienceCap`** to 500+ or null; consider **separate persona/segment** from Morpheus.
- Morpheus: expect send rate to recover as Jun 1–3 sends age out of rolling week; consider **releasing locks** or pausing to refresh cohort if stuck on 1,012 locked freq-capped users.

---

## Open questions for product

1. Cohort selection: **random** sample of eligible pool vs **prioritizeLastSeen** vs segment order?
2. On cohort assign, **preempt** users locked to another agent or skip?
3. Should **`audienceCap`** be deprecated when `uniqueUsersCap` is set?
4. Should **exploration windows** apply to all lapsed substages (`lapsed_wau`, `lapsed_dau4`, `lapsed_mau`)?
5. Is **global 1-push/day across agents** still required when each agent has a disjoint pre-assigned cohort?
