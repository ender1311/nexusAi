# Reward Intelligence Panel + Recency Penalty — Design Spec

**Date:** 2026-05-06
**Status:** Approved

---

## Overview

Two deliverables:

1. **Reward Intelligence Panel** — a three-tab section below the demo wizard on `/demo` that visualises how the Thompson Sampling algorithm learns from push sends: signal hierarchy, live Beta-distribution curves ("the video"), and a ranked "what to test next" view.
2. **Recency / Novelty Penalty** — adds Duolingo-style arm demotion to `ThompsonSampling.select()` so recently-sent variants are down-weighted, preventing over-exploitation of a single arm.

---

## Part 1 — Reward Intelligence Panel

### Placement

A new `RewardIntelligencePanel` client component rendered directly below `<LiveDemoWizard />` on `src/app/demo/page.tsx`. The demo page becomes a server component that passes `agentId` (from `searchParams.agent`) as a prop to both the wizard and the panel.

Both the wizard and the panel share the same `agentId` via a URL search param (`?agent=<id>`). When the user selects an agent inside the wizard, the wizard does a shallow router push to set `?agent=<id>`. The panel reads this param directly and re-fetches.

When no agent is selected, the panel shows a muted placeholder: "Select an agent above to see how it learns."

### Tab 1 — Signal Hierarchy

Static content (no API call). Displays a ranked table of reward signals from best to worst, sourced from the actual `TIER_BASE_REWARDS` values in `reward-calculator.ts`, with YouVersion-specific event names and plain-English explanations.

| Rank | Signal | Reward | When it happens |
|------|--------|--------|-----------------|
| ✅ Best | `plan_completed` | +10 | User finished a reading plan |
| ✅ Very Good | `prayer_completed` | +7 | User prayed after receiving push |
| ✅ Good | `push_open` | +5 | User opened the app from the notification |
| ❌ Bad | `push_dismissed` | −2 | User explicitly swiped away |
| ❌ Very Bad | `push_ignored` | −5 | Notification expired with no interaction |
| 🚫 Worst | `push_disabled` | −10 | User turned off notifications entirely |

Each row is color-coded (green gradient → red). A short paragraph explains the normalization to [−1, 1] and how `alpha` increments on positive reward and `beta` increments on non-positive.

### Tab 2 — Beta Curves ("the video")

An animated chart showing the Beta distribution PDF for each active variant, per persona. This is the primary visual component.

**Data source:** New `GET /api/demo/arm-stats?agentId=<id>` endpoint. Returns `PersonaArmStats[]` for the given agent. Protected by the existing WorkOS middleware (same as other `/api/demo/` routes — no additional auth needed since these are already behind auth).

**Rendering:**
- Recharts `AreaChart` with `x` ∈ [0, 1] (conversion rate axis) and `y` = Beta PDF value
- PDF computed client-side: approximate Beta PDF using the log-gamma function evaluated at 50 points across [0.001, 0.999]
- One curve per (persona, variant) pair, colored by variant; different line styles per persona
- Animates on mount via Recharts `isAnimationActive`
- Shows `α`, `β`, `E[θ] = α/(α+β)`, and a confidence label: "Exploring" (α+β < 40) / "Learning" (40–200) / "Converged" (>200)
- When no arm stats exist yet (agent just created), shows a single flat `Beta(1,30)` prior curve with label "Prior — no data yet"

**Log-gamma approximation for Beta PDF:**
```
logBeta(a, b) = logGamma(a) + logGamma(b) - logGamma(a+b)
betaPDF(x, a, b) = exp((a-1)*ln(x) + (b-1)*ln(1-x) - logBeta(a, b))
```
Uses Lanczos approximation for logGamma (7-coefficient, standard). Computed entirely in browser — no server math needed.

### Tab 3 — What to Test Next

Pulls the same arm stats data from Tab 2 (shared fetch, no duplicate call). Ranks all (persona, variant) pairs by posterior variance:

```
V(a, b) = (a * b) / ((a + b)^2 * (a + b + 1))
```

Higher variance = wider Beta = algorithm is more uncertain = should send to more users.

**Display:** A ranked list with three bands:

- 🔬 **Explore more** — high variance (algorithm uncertain; wide posterior)
- 🧪 **Promising** — high posterior mean (`E[θ] > 0.10`) but fewer than 50 total sends
- ✅ **Converged** — narrow posterior, mean well-established; consider retiring if mean < 0.05

Each row shows: variant name, persona chip, α, β, posterior mean as a percentage, variance score, and a status badge.

A brief paragraph explains: "Thompson Sampling self-regulates exploration — new or uncertain arms naturally receive more sends because their wide Beta distribution occasionally samples very high. You don't need to tune an epsilon; uncertainty drives exploration automatically."

---

## Part 2 — Recency / Novelty Penalty

### Motivation

Without a recency penalty, Thompson Sampling can over-exploit a high-performing arm — sending the same variant to the same user repeatedly. Duolingo (KDD 2020) showed this causes novelty decay: the same notification becomes less effective with repetition. Their fix: demote arms that were recently sent, using a forgetting-curve multiplier.

### Engine Change — `ThompsonSampling.select()`

Add an optional second parameter:

```typescript
select(arms: BanditArm[], recencyPenalties?: Record<string, number>): DecisionResult
```

After sampling `θ_k ~ Beta(α_k, β_k)` for each arm, apply:

```typescript
const adjusted = θ_k * (recencyPenalties?.[arm.id] ?? 1.0);
```

Selection proceeds on `adjusted` values. The pure function remains pure — no DB access. The caller is responsible for building the penalty map.

### Penalty Formula

```
multiplier(daysSinceSent) = exp(−0.3 × daysSinceSent)
```

| Days since last sent | Multiplier |
|----------------------|-----------|
| 0 (today) | 0.74 |
| 1 | 0.55 |
| 2 | 0.41 |
| 3 | 0.30 |
| 5+ | ≈ 0.22 (floor: 0.2) |
| Never sent | 1.00 (no penalty) |

Floor at 0.2 so a never-winning arm can't be zeroed out by recency alone.

### Caller Change — `select-and-send/route.ts`

In both the lottery pipeline (line 644) and the in-window pipeline (line 902), before calling `new ThompsonSampling().select(arms)`:

1. Collect `userExternalIds` for the current page of users
2. Query `UserDecision` for the most recent send per (userId, variantId) within the last 7 days:

```sql
SELECT userId, messageVariantId, MAX(sentAt) as lastSentAt
FROM UserDecision
WHERE agentId = ? AND userId IN (?) AND sentAt >= NOW() - INTERVAL '7 days'
GROUP BY userId, messageVariantId
```

3. For each user, build `recencyPenalties: Record<variantId, multiplier>` and pass to `select()`

**Query cost:** One additional `groupBy` query per 500-user page, similar in cost to the existing frequency-cap query already running. Queries are run in parallel with other per-page lookups where possible.

**Scope:** Only the `ThompsonSampling` path. `EpsilonGreedy` is unaffected (it uses a different selection model with its own exploration mechanism).

---

## New API Endpoint

**`GET /api/demo/arm-stats`**

- Query param: `agentId` (required)
- Returns: `{ agentId, agentName, armStats: PersonaArmStats[] }` where each row includes `personaId`, `variantId`, `alpha`, `beta`, `tries`, `wins`, plus persona `name`/`color` and variant `name`/`body` via joins
- Auth: WorkOS middleware (same as all `/api/demo/` routes)
- No new DB tables required

---

## Files Touched

| File | Change |
|------|--------|
| `src/app/demo/page.tsx` | Add `RewardIntelligencePanel` below wizard; pass `agentId` from searchParams |
| `src/components/demo/RewardIntelligencePanel.tsx` | New component: 3-tab panel |
| `src/app/api/demo/arm-stats/route.ts` | New GET endpoint |
| `src/lib/engine/thompson-sampling.ts` | Add `recencyPenalties` param to `select()` |
| `src/app/api/cron/select-and-send/route.ts` | Build + pass penalty map for each user page |

---

## Testing

- Unit test: `ThompsonSampling.select()` with recency penalties — verify penalised arm is less likely to win when its sampled value is high but multiplier is low
- Unit test: `betaPDF()` helper — verify it integrates to ≈ 1.0 over [0,1] for several (α, β) pairs
- Integration test: `GET /api/demo/arm-stats` returns correct arm stats shape
- Integration test: recency penalty query in `select-and-send` — verify recent decisions produce correct multiplier map
