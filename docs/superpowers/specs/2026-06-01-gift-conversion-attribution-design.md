# Gift Conversion Attribution + Insights — Design

**Date:** 2026-06-01
**Status:** Approved (design A–F), spec for implementation planning

## Goal

Make "Give a gift" a real, working conversion goal: when a tracked user makes a
gift shortly after a Nexus send, attribute that gift to the sending agent/variant,
feed an **amount-weighted** reward into the bandit, and surface gift performance
(count, revenue, conversion rate, time-to-gift) at the user, agent, and fleet level.

## Background / current state

Gift attribution is **partially wired but inert today**:

- Gift data arrives as **user attributes** via Hightouch (`/api/ingest/users`), not
  as a discrete event. Payload of record: `docs/json/hightouch-gift-payload.json`
  (key fields: `gift_amount_most_recent`, `gift_amount_most_recent_timestamp`,
  `gift_currency_most_recent`, plus donor signals used by `giving-link.ts`).
- `src/app/api/ingest/users/route.ts:893–996` already detects
  `gift_amount_most_recent_timestamp`, finds the most-recent unattributed
  `UserDecision` (within a 30-day window, `brazeSendId NOT NULL`), and calls
  `calculateReward("gift_given", decision.agent.goals, { gift_amount_most_recent })`.
- **Bug:** the UI preset goal is named `gift_completed`
  (`src/lib/constants/youversion.ts:14`), but `reward-calculator` matches goals by
  exact `eventName` (`src/lib/engine/reward-calculator.ts:31`). A `gift_given`
  conversion therefore finds no matching goal → reward 0 → the bandit never moves.
- **Saturation:** reward is `clamp((tierBase × weight) / 100, -1, 1)`. With
  tierBase 10, any gift ≥ ~$2 saturates to 1 → gift size is invisible to the bandit.
- **No raw value persisted:** only the normalized reward [-1,1] lands on
  `UserDecision`. There is no column to aggregate gift revenue per agent.
- **Double-attribution risk:** no per-user guard, so one gift timestamp can attribute
  to one decision on this sync and an older unattributed decision on the next sync.

`src/lib/engine/giving-link.ts` already exports `CURRENCY_RATES` (units of foreign
currency per 1 USD) — reuse for USD normalization rather than building new FX logic.

## Decisions (locked)

1. **Canonical event name:** `gift_given` everywhere (rename the preset).
2. **Reward:** amount-weighted, log-scaled (non-saturating to a tunable cap).
3. **Insights:** all four metrics — gifts driven (count), gift revenue ($),
   gift conversion rate (gifts ÷ sends), time-to-gift — at user / agent / fleet level.

## Design

### A. Unify the event name → `gift_given`

- `src/lib/constants/youversion.ts`: change the preset `eventName` `gift_completed`
  → `gift_given` (label "Give a gift" unchanged, tier `best`). Update
  `GREEN_GOAL_EVENTS` in the same file (`gift_completed` → `gift_given`).
- Update any test referencing `gift_completed`
  (`tests/unit/youversion-goal-color.test.ts`).

### B. Persist USD-normalized gift value

- Prisma: add `conversionValue Float?` to `model UserDecision`. Holds the
  **USD-normalized** gift amount for an attributed `gift_given` decision; null otherwise.
- Reward stays in `reward` (normalized [-1,1]); `conversionValue` is the reporting
  number that SQL can `SUM`.
- **Migration applies to BOTH databases:** `npx prisma migrate dev` for prod
  (prisma.config.ts → .env.local), and an explicit `ALTER TABLE "UserDecision" ADD
  COLUMN "conversionValue" double precision` against the **test DB** via the `neon()`
  HTTP client with the test `DATABASE_URL` (never `prisma db push` on test). Per the
  test-vs-prod DB drift rule.

### C. USD normalization helper

- Add `usdAmount(amount: number, currency: string | null): number` to
  `src/lib/engine/giving-link.ts` (pure): `amount / (CURRENCY_RATES[currency] ?? 1)`,
  defaulting unknown/blank currency to USD (rate 1). Round to cents.
- Unit-tested in `tests/unit/engine/`.

### D. Amount-weighted reward (pure)

In `src/lib/engine/reward-calculator.ts`, when `conversionEvent === "gift_given"`
and a matching goal exists, compute reward from the USD amount instead of the flat
weight:

```
GIFT_REWARD_CAP_USD = 1000            // tunable
usd  = Number(eventProperties.gift_amount_usd) || 0
frac = Math.log10(1 + usd) / Math.log10(1 + GIFT_REWARD_CAP_USD)
reward = clamp((tierBase / 10) * frac, 0, 1)
```

- tierBase comes from the goal's tier (so a non-`best` tier still scales down).
- Sanity points: $5≈0.26, $50≈0.57, $500≈0.90, $1000=1.0.
- Ingest passes `gift_amount_usd` (computed in C) in `eventProperties`.
- Funnel-recovery and all other event paths are unchanged.

### E. Ingest changes (`src/app/api/ingest/users/route.ts`, giving block ~893)

- Compute `usd = usdAmount(gift_amount_most_recent, gift_currency_most_recent)`.
- Call `calculateReward("gift_given", goals, { gift_amount_usd: usd, gift_amount_most_recent })`.
- On the `userDecision.update`, also write `conversionValue: usd`.
- **Dedup guard:** before attributing, skip if the user already has a `gift_given`
  decision whose `conversionAt` equals `giftDate` (same gift already attributed).
  Pre-load these per chunk alongside the existing `givingDecisionsByUser` query.

### F. Insights

Reuse the existing cache/query layering (`unstable_cache`, Suspense per section).
Every new `$queryRaw`/aggregate gets a regression test asserting exact SQL column names.

**Fleet / dashboard** — `src/lib/cache/dashboard.ts` + `src/app/page.tsx`:
- Total attributed gift count + gift revenue (`SUM(conversionValue)` where
  `conversionEvent='gift_given'`), fleet-wide, in the existing 30-day window.
- Agent leaderboard by attributed gift revenue (top N).

**Agent performance** — `src/lib/cache/performance.ts` +
`src/app/agents/[id]/performance/page.tsx`:
- Per-agent gift count, gift revenue, gift conversion rate
  (`gift_given decisions ÷ sends`), avg time-to-gift
  (`AVG(conversionAt - sentAt)` for `gift_given`).

**User level** — `src/app/api/users/[externalId]/route.ts` +
`src/components/control-tower/user-inspector.tsx`:
- Per-user: gifts driven via Nexus (count), total attributed $, and time-to-gift
  for the most recent attributed gift, with the attributing agent name.

### Components / files touched

| File | Responsibility / change |
|------|------------------------|
| `prisma/schema.prisma` | add `UserDecision.conversionValue Float?` |
| `src/lib/constants/youversion.ts` | rename preset + green set to `gift_given` |
| `src/lib/engine/giving-link.ts` | add `usdAmount()` helper |
| `src/lib/engine/reward-calculator.ts` | amount-weighted `gift_given` branch |
| `src/app/api/ingest/users/route.ts` | USD normalize, store `conversionValue`, dedup guard |
| `src/lib/cache/dashboard.ts` | fleet gift count/revenue + leaderboard query |
| `src/app/page.tsx` | render fleet gift insight |
| `src/lib/cache/performance.ts` | per-agent gift metrics query |
| `src/app/agents/[id]/performance/page.tsx` | render per-agent gift metrics |
| `src/app/api/users/[externalId]/route.ts` | per-user gift attribution in response |
| `src/components/control-tower/user-inspector.tsx` | render per-user gift insight |

## Testing

- **Unit:** `usdAmount()` (currency table + unknown/blank default); `gift_given`
  reward formula (sanity points, $0→0, clamp); updated color test for `gift_given`.
- **Integration:** post a `/ingest/users` gift payload after a seeded recent send →
  assert the decision gets `conversionEvent='gift_given'`, `conversionAt`,
  `conversionValue` (USD), and non-null `reward`; re-post same gift → no second
  attribution (dedup); gift outside 30-day window → no attribution.
- **Regression:** event-name unification (a `gift_given` goal now yields reward > 0);
  exact SQL column names for each new aggregate (dashboard, performance, user).
- **Component:** insight cards render counts/$ given mocked data.

## Out of scope

- Wizard "Add Custom Goal" free-text path (unchanged).
- Backfilling historically-missed gift attributions.
- Multi-currency display formatting (revenue reported as USD-normalized total).
- Recurring-gift / lifetime-value modeling beyond the single most-recent gift.

## Risks / things to watch

- `gift_amount_most_recent_timestamp` must be the **gift datetime**, not sync time —
  the 30-day window depends on it.
- USD normalization is only as good as `CURRENCY_RATES`; stale rates skew revenue but
  not attribution correctness.
- Reward cap ($1000) is tunable; revisit if gift sizes cluster differently in prod.
