# Exclusive Agent Assignment + Funnel-Recovery Conversions

**Date:** 2026-05-31
**Status:** Approved for implementation
**Builds on:** `2026-05-02-user-agent-assignment-design.md` (8-day exploration window), `2026-05-02-agent-lottery-global-daily-cap-design.md`
**Followed by:** Spec 2 — Cross-Agent User Insight Store (separate spec, depends on this one)

---

## Goal

Two coupled capabilities, shipped together:

1. **Exclusive assignment + release** — every user is owned by exactly one agent across the whole fleet until that agent releases them. Release happens on conversion, on the user exiting the agent's target cohort, when a hold cap is reached, or manually.

2. **Funnel-recovery conversions** — a lapsed user counts as a conversion when they climb back to an active funnel stage at least as engaged as their pre-lapse tier. Recoveries feed the bandit reward (scaled by how high they climbed) and are surfaced per-agent and fleet-wide in the dashboards.

Ownership makes recovery attribution exact (the owning agent gets credit) and gives operators a clear mental model: one agent works a user at a time, then hands them off.

---

## Background (current state)

- **Funnel taxonomy** (`src/types/agent.ts`): `new, dau4, wau, mau, lapsed_dau4, lapsed_wau, lapsed_mau`. By engagement, `dau4 > wau > mau`. Hightouch sends `lapsed_dau`, normalized to `lapsed_dau4` at ingest. "Habitual DAU4/WAU" are Hightouch *audience names*; the active `funnel_stage` value is just `dau4`/`wau`. No new stage values are introduced.
- **Conversions today** (`src/app/api/ingest/events/route.ts`): an inbound event is matched to the most-recent unconverted `UserDecision` for that user within a window (48h, or 30d for long-horizon events), scored by a per-agent `Goal` (tier × weight) into a reward clamped to `[-1, 1]`, which updates `UserDecision` and the bandit arms (`PersonaArmStats`, `UserArmStats`, `LinUCBArm`). `push_disabled` applies a −1.0 penalty to recent decisions.
- **Reward calculator** (`src/lib/engine/reward-calculator.ts`): `TIER_BASE_REWARDS = { best:10, very_good:7, good:5, bad:-2, very_bad:-5, worst:-10 }`; `reward = clamp((tierBase × weight) / 100, -1, 1)`. `weightMode: "property"` reads a numeric `eventProperties[weightProperty]`.
- **Assignment today** (`UserAgentAssignment`): exists only for the lapsed/connected **8-day, 4-send exploration window**. `externalUserId @unique` (one active row), overwritten on re-assignment after a 90-day cooldown (`AppSetting exploration_window_cooldown_days`). After 4 sends `windowCompletedAt` is set and the user **re-enters the lottery**.
- **Cron** (`src/app/api/cron/select-and-send/route.ts`): Phase 0 assignment (exploration windows) → lottery (`buildAgentLottery`, in-memory, one agent per user per run) → caps (`audienceCap`, `dailySendCap`, `uniqueUsersCap`) → send. A transient `TrackedUser.lockedByAgentId` guards the within-run race.
- **Observability**: per-agent `src/app/agents/[id]/performance/page.tsx`; fleet `src/app/page.tsx`, `src/app/performance/page.tsx`, `src/app/control-tower/page.tsx`; reusable charts in `src/components/charts/` (`MetricCard`, `TimeSeriesChart`, etc.); fleet pages read via `getCached*` query functions.

---

## Part A — Exclusive Assignment + Release

### A1. Ownership model

Generalize `UserAgentAssignment` from "exploration-window-only" into **the** persistent, fleet-wide ownership record for **every** assigned user (all agent types, not just lapsed/connected).

```prisma
model UserAgentAssignment {
  id                String    @id @default(cuid())
  externalUserId    String    @unique          // one active/most-recent row per user (fleet-wide exclusivity)
  agentId           String
  startedAt         DateTime  @default(now())
  sendCount         Int       @default(0)
  lastSentAt        DateTime?                   // NEW — last send under this assignment
  windowCompletedAt DateTime?                   // exploration window done (first 4 sends) — preserved
  releasedAt        DateTime?                   // NEW — null = actively owned; non-null = released, claimable
  releaseReason     String?                     // NEW — conversion | cohort_exit | hold_cap_days | hold_cap_sends | manual

  @@index([agentId])
  @@index([releasedAt])
  @@index([windowCompletedAt])
}
```

- **Fleet-wide exclusivity**: `externalUserId @unique` keeps one row per user. A user is *actively owned* iff a row exists with `releasedAt IS NULL`. A released row (`releasedAt` set) marks the user claimable. On a new claim the row is **overwritten** (upsert): new `agentId`, `startedAt = now`, `sendCount = 0`, `lastSentAt = null`, `windowCompletedAt = null`, `releasedAt = null`, `releaseReason = null`. (Keeping `@unique` avoids a partial-unique-index migration; historical release reasons are not retained in this table — recovery history lives in `FunnelTransition`, Part B.)

### A2. Hold caps (new Agent fields)

```prisma
// Agent model — add:
holdMaxDays  Int @default(90)   // auto-release after this many days owned without conversion
holdMaxSends Int @default(24)   // auto-release after this many sends without conversion
```

Per-agent overridable; fleet defaults **90 days / 24 sends**, "whichever comes first." `holdMaxDays = 90` intentionally matches the legacy exploration-window cooldown.

### A3. Behavior change to the exploration window

The new ownership model **supersedes** the legacy "re-enter the lottery after 4 sends" behavior:

- The 8-day / 4-send exploration window still runs for lapsed/connected agents; `windowCompletedAt` is still set at 4 sends (exploration → exploitation transition).
- **After window completion the user REMAINS OWNED by the same agent** (now exploiting its best variant) until a release trigger fires. The agent is no longer forced to hand the user back at 4 sends.
- The hold cap (24 sends / 90 days) is the backstop that prevents indefinite ownership without a conversion.
- The `exploration_window_cooldown_days` AppSetting is retired in favor of `Agent.holdMaxDays` (default preserves the 90-day value).

### A4. Cron changes (`select-and-send`)

**New Phase −1: Release sweep** (runs first, so freed users are claimable in the same run). Load all active assignments (`releasedAt IS NULL`), join the owning agent and the user's current `funnelStage`/segments, and release any that match:

- **cohort_exit** — the user's current `funnelStage` (and `segmentTargeting` includes/excludes, if set) no longer matches the owning agent's target.
- **hold_cap_days** — `now − startedAt > agent.holdMaxDays`.
- **hold_cap_sends** — `sendCount ≥ agent.holdMaxSends`.

Release = set `releasedAt = now`, `releaseReason` accordingly. Per-assignment failures are caught and logged; one bad row never aborts the sweep.

**Phase 0 / lottery (modified):**
- Eligibility now **excludes any user with an active assignment to a different agent** (`releasedAt IS NULL AND agentId != thisAgent`). Users with no row, a released row, or a row owned by this agent are eligible.
- The lottery winner is **persisted as an assignment** (durable owner) via upsert, not just the transient `lockedByAgentId`. The lock remains only as the within-run race guard.
- On each actual send: increment `sendCount`, set `lastSentAt = now`; set `windowCompletedAt` at 4 sends for exploration-window agents (unchanged).

**Caps:** `audienceCap`, `dailySendCap`, `uniqueUsersCap` unchanged.

### A5. Release-on-conversion

Implemented in the shared attribution module (Part B3): whenever a conversion is credited to an agent that **currently owns** the user, that assignment is released (`releaseReason = conversion`). Applies to *all* conversions — existing events and funnel recoveries alike — satisfying the "release on conversion" trigger uniformly.

### A6. Manual release

`POST /api/agents/[id]/release`
- Body `{ userId: string }` → release that one user's active assignment to this agent.
- Empty body → release **all** active assignments for this agent.
- `requireAdmin`; 404 if the agent doesn't exist; returns `{ data: { released: number } }`. Sets `releasedAt = now`, `releaseReason = manual`.
- UI: a "Release all" button on the agent page and a per-user release action in the decision log.

---

## Part B — Funnel-Recovery Conversions

### B1. Recovery rule (pure engine module)

`src/lib/engine/funnel-recovery.ts`:

```ts
const ACTIVE_RANK: Record<string, number> = { mau: 1, wau: 2, dau4: 3 };
const LAPSED_COUNTERPART_RANK: Record<string, number> = {
  lapsed_mau: 1, lapsed_wau: 2, lapsed_dau4: 3,
};

// True when `from` is a lapsed stage and `to` is an active stage whose rank
// is >= the lapsed stage's counterpart rank. `new` is never a recovery target.
export function isRecovery(from: string, to: string): boolean;

// The reached active rank (1=mau, 2=wau, 3=dau4); only meaningful when isRecovery(from,to).
export function recoveryRank(to: string): number;
```

Resulting matrix (✓ = conversion):

| from \ to    | mau | wau | dau4 | new | lapsed_* |
|--------------|-----|-----|------|-----|----------|
| lapsed_mau   | ✓   | ✓   | ✓    | ✗   | ✗        |
| lapsed_wau   | ✗   | ✓   | ✓    | ✗   | ✗        |
| lapsed_dau4  | ✗   | ✗   | ✓    | ✗   | ✗        |

`recoveryRank` is the **destination** engagement tier, so reaching `dau4` always rewards most (rank 3) and reaching `mau` least (rank 1) — i.e. bigger climbs reward more.

### B2. Recovery reward (scaled by jump)

In `reward-calculator.ts`, add a built-in branch for the synthetic event `funnel_recovery` (evaluated only when no explicit agent `Goal` for `funnel_recovery` exists — an agent Goal still overrides):

```ts
const RECOVERY_RANK_TIER = { 1: "good", 2: "very_good", 3: "best" } as const; // 5 / 7 / 10
const RECOVERY_WEIGHT = 5; // tunable constant
// reward = clamp(TIER_BASE_REWARDS[RECOVERY_RANK_TIER[rank]] * RECOVERY_WEIGHT / 100, -1, 1)
// → mau: 0.25, wau: 0.35, dau4: 0.50
```

These sit comfortably above a single ordinary conversion (e.g. `plan_completed` ≈ 0.10) without pinning the `[-1,1]` ceiling. Tunable via the single `RECOVERY_WEIGHT` constant.

### B3. Shared attribution module (refactor)

Extract the inline attribution/reward/arm-update logic from `ingest/events/route.ts` into `src/lib/engine/attribution.ts` so both the events route and recovery detection share one tested implementation.

```ts
// Applies a credited conversion to a specific decision: computes reward,
// updates UserDecision (conversionEvent, conversionAt, reward), updates
// PersonaArmStats / UserArmStats / LinUCBArm, and releases the owning
// assignment if the credited agent currently owns the user (releaseReason "conversion").
export async function applyConversion(args: {
  decision: UserDecision;        // the decision receiving credit
  conversionEvent: string;
  occurredAt: Date;
  properties?: Record<string, unknown>;
}): Promise<{ reward: number }>;
```

- The **events route** keeps its window-based matching (48h / 30d) to find the decision, then calls `applyConversion`. The only behavior addition: release-on-conversion when the matched decision's agent owns the user.
- **Recovery** uses **ownership-based** matching (B4), not a time window — ownership supersedes the earlier "60-day window" idea for recoveries.
- The `push_disabled` penalty path is preserved as-is (bulk −1.0; not routed through `applyConversion`).

### B4. Recovery detection + attribution (at user-sync ingest)

In `ingest/users/route.ts`, when upserting a `TrackedUser` whose stored `funnelStage` differs from the incoming one, compute `isRecovery(stored, incoming)`:

- **If recovery:**
  1. Look up the user's **active** `UserAgentAssignment` (`releasedAt IS NULL`).
  2. **Owned** → the owning agent is credited. Find that agent's most-recent unconverted `UserDecision` for the user; if one exists, call `applyConversion({ decision, conversionEvent: "funnel_recovery", occurredAt: now, properties: { from_stage, to_stage, recovery_rank } })` (rewards the variant arm, marks the decision converted, **releases the assignment** with reason `conversion`). Write a `FunnelTransition` row **attributed** to that agent/decision.
  3. **Unowned** (organic recovery, or owned-but-no-decision edge) → write a `FunnelTransition` row with **null** attribution and **no** bandit reward.
- Detection fires exactly once per transition because the upsert overwrites `stored → incoming` in the same write, so the next sync sees no change. A later active→lapsed→active cycle is a fresh transition ⇒ **once per lapse episode**.
- Wrapped so a detection/attribution failure logs and continues — never breaks the (non-destructive) user-sync. Within-batch user dedup prevents same-row double-fire.

### B5. Recovery log

```prisma
model FunnelTransition {
  id                   String   @id @default(cuid())
  externalUserId       String
  fromStage            String
  toStage              String
  recoveryRank         Int
  detectedAt           DateTime @default(now())
  attributedAgentId    String?            // null = organic (no active owner)
  attributedDecisionId String?

  @@index([attributedAgentId, detectedAt])
  @@index([detectedAt])
  @@index([externalUserId])
}
```

Every qualifying recovery writes one row (attributed or organic). This decouples reporting from the bandit signal: recovery rate, lift-vs-organic, and per-agent breakdowns are simple aggregations over this table.

---

## Part C — Observability

### C1. Per-agent (`src/app/agents/[id]/performance/page.tsx`)

A new **Re-engagement** section:
- KPIs (`MetricCard`): Recoveries (30d), Recovery rate = attributed recoveries ÷ distinct lapsed users this agent owned in the window, Reward from recoveries (sum), Currently-owned users.
- `from → to` transition breakdown (small table or stacked bar).
- Recovery trend (`TimeSeriesChart`, recoveries/day).

Data: queries over `FunnelTransition` (`attributedAgentId = agent.id`) and `UserAgentAssignment` (`agentId = agent.id`), added to the page's data layer following the existing direct-Prisma pattern.

### C2. Cross-agent

- **Dashboard** (`src/app/page.tsx`): KPI "Lapsed users recovered (30d)" + fleet recovery rate, near the existing funnel-stage breakdown.
- **Performance** (`src/app/performance/page.tsx`): Re-engagement **leaderboard** (agents ranked by recoveries / recovery rate / reward), a fleet-wide `from→to` transition breakdown chart, and a fleet recovery trend.
- **Control-tower** (`src/app/control-tower/page.tsx`): a compact re-engagement summary tile.

Data: new `getCached*` aggregation functions over `FunnelTransition` + `UserAgentAssignment`, grouped by agent, alongside the existing cached query functions. Reuse `MetricCard`, `TimeSeriesChart`, and the existing bar/table primitives.

---

## Data flow

```
Hightouch user-sync ─▶ ingest/users
   └─ funnelStage changes? ─ isRecovery(stored, incoming)?
        ├─ owned   ─▶ applyConversion(owning agent's latest decision)  ─▶ reward + arm update + RELEASE + FunnelTransition(attributed)
        └─ unowned ─▶ FunnelTransition(organic, no reward)

Hightouch events ─▶ ingest/events
   └─ window-match decision ─▶ applyConversion ─▶ reward + arm update + RELEASE-if-owner

Cron select-and-send
   ├─ Phase −1 Release sweep: cohort_exit / hold_cap_days / hold_cap_sends
   ├─ Phase 0 Lottery: exclude users owned by other agents; winner persisted as assignment
   └─ Phase 2 Send: sendCount++, lastSentAt; windowCompletedAt at 4 sends
```

---

## Error handling

- User-sync recovery detection and the cron release sweep are per-record fault-isolated (catch, log, continue); they never abort the batch/run.
- Concurrent claim races: `externalUserId @unique` upsert conflict (P2002) is caught and treated as "already owned," skip.
- Reward stays clamped to `[-1, 1]`; `reward === 0` continues to store `UserDecision.reward = null`.
- API routes follow `src/app/api/CLAUDE.md`: `{ data }` / `{ error }`, validate before DB, `requireAdmin` on mutations, no Prisma internals leaked.

---

## Migrations

Schema changes: `Agent.holdMaxDays`, `Agent.holdMaxSends`; `UserAgentAssignment.lastSentAt`, `.releasedAt`, `.releaseReason`; new `FunnelTransition` model. Apply via `npx prisma migrate dev` (prod) **and** to the test DB via `ALTER TABLE` through the Neon HTTP client with the test `DATABASE_URL` (per `CLAUDE.md` — never `prisma db push`/`migrate` against the test DB).

---

## Testing

### Unit
- `funnel-recovery.ts`: the full transition matrix in B1 (every `from × to`), including the non-conversions `lapsed_dau4→mau`, `lapsed_dau4→wau`, `lapsed_wau→mau`, any `→new`, and `lapsed_*→lapsed_*`; `recoveryRank` correctness; monotonic reward (mau < wau < dau4).
- Release-trigger predicates: cohort-exit match logic; hold-cap boundaries (89d no-release / 91d release; 23 sends no / 24 sends yes).
- `reward-calculator.ts`: `funnel_recovery` built-in values (0.25 / 0.35 / 0.50) and explicit-Goal override.

### Integration
- User-sync recovery for an **owned** user → owning agent credited, decision converted, arms updated, assignment released (`conversion`), attributed `FunnelTransition` written.
- User-sync recovery for an **unowned** user → organic `FunnelTransition`, no reward, no release.
- Events route still attributes and rewards correctly through `attribution.ts` (regression of existing behavior) and now releases an owning agent on conversion.
- Cron release sweep: cohort_exit, hold_cap_days, hold_cap_sends each release correctly; eligibility excludes users owned by another agent; lottery winner persisted as an assignment; **fleet-wide exclusivity** — two agents targeting one user yield exactly one active owner.
- Manual release endpoint: single user and release-all; auth + 404.
- Recovery metrics queries (per-agent + cross-agent) return correct shapes/counts.

### Regression (`tests/regression/`, each with a comment linking the rule)
- Exact spec matrix, especially `lapsed_dau4→mau`/`→wau` are **not** conversions.
- Double-fire prevention: two consecutive syncs showing the same transition credit/log it once.
- Organic recovery logged but unattributed when no active owner.
- Hold-cap boundary release timing.
- Any `$queryRaw` added to a dashboard/page: assert exact column names.

---

## Out of scope (→ Spec 2: Cross-Agent User Insight Store)

Carrying a consolidated per-user profile (best channel, best send hour, global responsiveness prior to warm-start a new owner's per-user arm priors, fatigue signals) into every agent's selection path. This spec deliberately stops at: global facts already shared (feature vector, persona, prefs) + persona warm-start + the new `FunnelTransition` history that Spec 2 will consume.
