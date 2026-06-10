# Neon Compute Cost Reduction — Design

**Date:** 2026-06-10
**Status:** Approved by Dan (conversation, 2026-06-10)

## Problem

The Neon project `solitary-cherry-26476014` (endpoint `ep-old-surf-a4p5os6s`) bills ~$400/mo of compute — an average of ~3.3 CU running around the clock. Verified live config: autoscaling 0.25–4 CU, autosuspend 300 s.

Two structural causes:

1. **The DB almost never idles.** Vercel crons fire at :00 (`select-and-send`) and :45 (`materialize-segments`) every hour, splitting each hour into two short idle windows; Hightouch syncs (~every 4 h) hit ingest in between. The 300 s autosuspend rarely gets a chance to fire.
2. **Hourly full scans.** `materializeAllSegments` re-runs `INSERT … SELECT FROM "User"` (34.7 M rows) plus a delete sweep for **every** agent-referenced rule segment, **every hour**, even when neither the rule nor the user data changed. These scans pin autoscaling near the 4 CU ceiling.

Decisions made during brainstorming: `select-and-send` stays hourly (product heartbeat); materialization becomes drift-aware; max CU drops to 2.

## Changes

### 1. Drift-aware materialization skip (code)

Skip a segment's re-materialization when nothing that could change its membership has happened since the last run.

**Schema (additive only — never destructive on prod):**
- `Segment.materializedAt` `TIMESTAMP NULL` — set to `runStart` after a successful materialization of that segment.
- `AppSetting` key `last_user_ingest_at` — ISO timestamp, bumped by `POST /api/ingest/users` (the only ingest path that writes the `User` table; rules compile over `User` only, so `UserSegment`/event ingest is irrelevant). Throttled: skip the write when the stored value is < 60 s old, so high-frequency ingest doesn't hammer one row.

**Skip predicate**, evaluated per segment inside `materializeAllSegments`:

```
skip = segment.materializedAt != null
    && segment.updatedAt <= segment.materializedAt                     // rule unchanged
    && lastUserIngestAt  <= segment.materializedAt - INGEST_MARGIN_MS  // no user-data drift
```

`INGEST_MARGIN_MS = 120_000` — twice the marker throttle. Because the marker write is throttled, up to 60 s of ingest can land *after* the stored marker but *before* a materialization; requiring the marker to be at least 2 min older than `materializedAt` guarantees those writes force a re-scan rather than being skipped until the next sync.

- Rule edits already touch `Segment.updatedAt` (Prisma `@updatedAt`), so an edited rule re-materializes on the next run automatically.
- `lastUserIngestAt` is read **once per cron run** (not per segment).
- **Fail-open:** if the `AppSetting` row is missing or unparseable, treat `lastUserIngestAt = now` — i.e. materialize everything (today's behavior). A failure must never skip toward staleness.
- New segments (`materializedAt = null`) always materialize.

**Observability:** `MaterializeSummary` gains `segmentsSkippedFresh: number`, and skipped segments get a `perSegment` entry with `skipped: "fresh"` so `/api/cron/runs` shows why a run was cheap. The existing `segmentsSkipped` (unparseable/empty rules) keeps its meaning.

**Expected effect:** with ~4-hourly Hightouch user syncs, full scans drop from 24/day to ~6/day per segment (~75 % fewer), and most :10 runs become two cheap reads (agents + segments + one AppSetting row).

### 2. Cron schedule alignment (config)

In `vercel.json`, move `materialize-segments` from `45 * * * *` to `10 * * * *`.

- Runs right after `select-and-send` (:00) while compute is already awake — one wake window per hour instead of two.
- Creates a single ~45-minute idle stretch (:15→:00) where the 300 s autosuspend can actually fire.
- Ordering note: membership used by `select-and-send` at :00 now comes from the :10 run of the **previous** hour — at most 50 min staler than today's :45 run. Acceptable: membership drift is driven by ~4-hourly syncs anyway, and the drift-aware skip already tolerates multi-hour freshness.

### 3. Lower autoscaling max CU 4 → 2 (Neon API)

One `PATCH /projects/{id}/endpoints/{endpoint_id}` call setting `autoscaling_limit_max_cu: 2` (min stays 0.25, suspend stays 300 s). Executed with Dan's explicit go-ahead at execution time, using `NEON_API_KEY` from `.env.local` (never printed).

- Risk: heavy queries take up to ~2× longer. Budgets hold: per-segment materialization currently completes well under the 60 s statement timeout, and the crons have a 300 s Vercel budget.
- Revert is the same API call with `4`. If `cron/runs` shows materialization failures or `select-and-send` duration spikes after the change, revert first, investigate second.

## Out of scope

- `select-and-send` cadence (stays hourly — decided).
- Hightouch sync frequency (external, feeds the product).
- Daily crons (`discover-personas`, `sync-template-variants`, `refresh-segment-facets`) and 6-hourly `ingest-braze-analytics` — already cheap relative to the hourly pair.
- Any destructive migration. The `materializedAt` column and `AppSetting` row are purely additive.

## Testing

- **Unit:** skip predicate — all branches (null `materializedAt`, rule newer, ingest newer, ingest inside the 2-min margin, both safely older ⇒ skip; missing marker ⇒ no skip).
- **Unit:** ingest-marker throttle (no write when < 60 s old; write when older or absent).
- **Integration:** `POST /api/ingest/users` bumps `last_user_ingest_at`; a subsequent materialize run re-scans.
- **Integration:** rule edit (`PUT` segment definition) forces re-materialization even when no ingest happened.
- **Regression:** a fully-skipped run leaves `UserSegment` rows for the segment byte-identical (no sweep deletions) and reports `segmentsSkippedFresh`.

## Success criteria

- Neon dashboard after ~1 week: compute hours and average CU both materially down (target ≥ 50 % bill reduction).
- No `materialize-segments` failures or `select-and-send` duration regressions in `/api/cron/runs`.
- Segment membership still reflects rule edits within one cron cycle and user syncs within one cycle of ingest.
