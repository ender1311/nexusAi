# Nexus Lift Measurement — Design Spec
**Date:** 2026-05-12
**Status:** Approved

## Problem

The Performance page currently shows "lift vs fleet average" — each Nexus agent compared against the mean of all Nexus agents. This is not lift in the meaningful sense: it only measures within-Nexus variance. There is no comparison against the pre-AI baseline, so stakeholders cannot answer "is Nexus actually working?"

Non-Nexus push open rates at YouVersion are ~1.2% (confirmed from internal Braze analytics knowledge; live Braze canvas data via API returned 0 active entries as of May 2026 — all older canvases are inactive).

## Goal

Add a lift measurement feature to the Performance page that compares Nexus AI-optimized push performance against the known non-Nexus baseline, with a configurable start date and a prominent display.

## Approach

**Server Component query** — compute lift in the existing Server Component by reading two `AppSetting` keys alongside current metric fetches. No new DB tables, API routes, or cron jobs.

## Data Model

Two new `AppSetting` keys (existing `key`/`value` text columns, no schema migration):

| Key | Default | Description |
|-----|---------|-------------|
| `baseline_push_open_rate` | `"1.2"` | Non-Nexus push open rate as a percentage string (e.g. `"1.2"` = 1.2%) |
| `lift_since_date` | `""` | ISO date string (YYYY-MM-DD). Empty = all-time. Earliest `sentAt` included in Nexus lift window. |

## Lift Calculation

**Nexus metric:** `reward > 0` as the conversion signal (populated by the analytics cron from Braze `/sends/data_series` click/open rates and by the Currents webhook on tap events).

```
nexusConversions = COUNT(UserDecision WHERE sentAt >= lift_since AND reward > 0)
nexusSends       = COUNT(UserDecision WHERE sentAt >= lift_since AND reward IS NOT NULL)
nexusRate        = nexusConversions / nexusSends   (as a percentage)

absoluteLift = nexusRate - baselineRate            (percentage points)
relativeLift = absoluteLift / baselineRate × 100   (percent)
```

**Statistical significance:** One-proportion z-test (baseline is a known fixed rate, not a sample):

```
z = (p̂ − p₀) / sqrt(p₀ × (1 − p₀) / n)

where:
  p̂  = nexusRate / 100
  p₀  = baselineRate / 100
  n   = nexusSends
```

Significant when `|z| > 1.96` (p < 0.05) AND `nexusSends >= 200`.

**Location:** New exported function `baselineLiftSignificance(nexusSends, nexusConversions, baselineRatePct)` in `src/lib/engine/lift-significance.ts`. Pure function, no side effects.

## Settings Page

New **"AI Lift Measurement"** section added to `/settings` below the existing Braze credentials section.

**Fields:**
- **Baseline push open rate (%)** — number input, default placeholder `1.2`, saves to `baseline_push_open_rate`
- **Measure Nexus lift from** — `<input type="date">`, saves to `lift_since_date`

**Save:** POST to existing `/api/settings` route (already handles arbitrary key/value upserts). On save, call `revalidateTag("lift-settings")` to bust the 24h cache.

**Read (caching):** New `getCachedLiftSettings()` function in `src/lib/cache.ts` — wraps `prisma.appSetting.findMany(...)` with `unstable_cache`, `revalidate: 86400`, tagged `["lift-settings"]`. Returns `{ baselineRate: number; liftSince: Date | null }`.

## Performance Page Changes

### Hero KPI Card

Replaces the existing "Best Agent Lift" card (which compared Nexus agents to each other — a less meaningful metric).

Displays:
- **Relative lift** (large, colored): e.g. `+175%` in green, or `−12%` in red
- **Absolute rates**: `3.3% vs 1.2% baseline`
- **Context line**: `1,420 sends · since May 12` (or `all-time` if no start date)

States:
- `nexusSends < 200`: gray, shows `~+X%`, tooltip "Fewer than 200 scored sends"
- `|z| < 1.96`: value shown with `n.s.` badge
- `nexusSends === 0`: shows `—`

### Lift Panel

New `<Card>` placed between the KPI row and `<ChartsSection>`, rendered as a Server Component.

**Layout:**
```
┌────────────────────────────────────────────────────────┐
│ AI Lift vs Non-Nexus Baseline                           │
│                                                         │
│  Baseline (non-Nexus)  Nexus            Lift            │
│  1.2% open rate        3.3% conv rate   +175% (+2.1 pp) │
│                                         ★ p < 0.05      │
│                                                         │
│  [sparkline: daily Nexus conv rate over the lift window]│
│                                                         │
│  Nexus rate = reward > 0 / scored sends                 │
│  Baseline: configured in Settings · since May 12, 2026  │
└────────────────────────────────────────────────────────┘
```

**Sparkline:** `getCachedChartDecisions()` will be extended to also return `reward: number | null` per row (one extra column in the existing SELECT, same 300s cache, no performance impact). The lift panel filters to `sentAt >= lift_since`, buckets by calendar day, and computes `reward > 0 / reward IS NOT NULL` per day. Uses existing `TimeSeriesChart` component. Note: the chart window is capped at 30 days; if `lift_since_date` is older than 30 days the sparkline shows only the most recent 30 days, while the headline lift numbers (KPI card, panel totals) use separate uncached `COUNT` queries covering the full window.

The **"Lift vs Avg" column** in the agent breakdown table is unchanged — it continues to measure within-Nexus variance across agents, which is useful for identifying underperforming agents.

## New Files

| File | Purpose |
|------|---------|
| `src/components/performance/lift-panel.tsx` | Lift Panel card (Server Component) |

## Modified Files

| File | Change |
|------|--------|
| `src/lib/engine/lift-significance.ts` | Add `baselineLiftSignificance()` function |
| `src/lib/cache.ts` | Add `getCachedLiftSettings()` (86400s revalidate, `lift-settings` tag); extend `getCachedChartDecisions()` to return `reward` field |
| `src/app/settings/page.tsx` | Add "AI Lift Measurement" section |
| `src/app/api/settings/route.ts` | Call `revalidateTag("lift-settings")` on save |
| `src/app/performance/page.tsx` | Replace "Best Agent Lift" card; add `<LiftPanel />` |

## Tests

- **Unit:** `baselineLiftSignificance()` — correct z-score, significance at boundary (n=199 vs n=200), zero-sends edge case, negative lift
- **Contract:** Settings API saves and retrieves both new keys correctly
- **Regression:** Performance page renders without error when settings are missing (graceful fallback to 1.2% / all-time)

## Out of Scope

- Live Braze canvas polling for baseline (canvases are all inactive; manual config is sufficient)
- Per-agent lift vs baseline (agents are already compared in the breakdown table)
- Historical lift trend stored in `ModelMetric` (premature; add if needed after data accumulates)
