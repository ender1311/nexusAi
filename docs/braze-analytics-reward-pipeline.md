# Braze Analytics → Reward Pipeline

> **Status:** Secondary / backstop path. The **primary** reward path is Braze
> Currents → `POST /api/ingest/braze-events` (per-user click → reward). This
> DB-based analytics sweep is a decay backstop for sends whose Currents event
> never arrived.

## Overview

The primary learning loop is closed per-user by Braze Currents events landing at
`/api/ingest/braze-events`. As a backstop, the `ingest-braze-analytics` cron pulls
aggregated per-send engagement stats from the Braze REST API and applies a
decaying reward to any decisions still missing one. This path is intentionally
simple and self-limiting.

---

## How It Works

### 1. Send Phase (`cron/select-and-send`)

For every group of users sent the same variant at the same scheduled time
(`src/lib/cron/send-grouping.ts`):

1. The message is dispatched — `POST /messages/schedule/create` for a future send
   (returns `schedule_id`) or `POST /messages/send` for immediate.
2. A **local** `randomUUID()` is stored on the batch's `UserDecision` rows as
   `brazeSendId` — an "accepted by Braze" marker, **not** a Braze-registered
   send_id (Nexus never calls `/sends/id/create`). `brazeScheduleId` is stored for
   scheduled sends.
3. Braze's real auto-assigned send_id returns later via Currents to
   `/api/ingest/braze-events`.

### 2. Analytics Ingestion (`cron/ingest-braze-analytics`, every 6h)

Runs as a backstop ~24–72h after sends (giving Braze time to accumulate data):

1. **Daily budget check**: counts distinct `brazeSendId` values already processed today (`brazeAnalyticsFetchedAt >= start_of_day`). Stops early if ≥ 900.
2. Fetches `GET /sends/data_series` / `GET /campaigns/data_series` for eligible decisions.
3. Derives a reward/punishment from the aggregated click and open rates.
4. Updates `PersonaArmStats` (Thompson Sampling Beta params) and marks decisions with `reward` + `brazeAnalyticsFetchedAt`.

---

## Reward Formula

| Signal | Condition | `reward` | `deltaAlpha` | `deltaBeta` |
|---|---|---|---|---|
| Click | `click_rate > 0` | `min(0.8, click_rate × 4)` | = reward | 0 |
| Open, no click | `click_rate == 0 && open_rate > 0` | `-0.15` | 0 | `0.15` |
| No engagement | `click_rate == 0 && open_rate == 0` | `-0.35` | 0 | `0.35` |

**Rationale:**
- Click is the primary success signal — the message caused an action.
- Opening without clicking is a mild negative signal — the copy wasn't compelling enough to drive behavior.
- No open at all is a stronger negative signal — the send may have been poorly timed, irrelevant, or suppressed at the device level.
- The `deltaAlpha`/`deltaBeta` values update the Beta distribution for Thompson Sampling. Increasing `beta` makes the arm less likely to be selected in future rounds.

---

## Daily Budget Cap (900 send_ids/day)

Braze limits `send_id` registrations to **100 per campaign per day**. With multiple agents and campaigns, the practical ceiling is ~900/day total. This self-imposed cap prevents accidentally exhausting the daily registration quota and serves as a circuit breaker.

The cap is tracked via `UserDecision.brazeAnalyticsFetchedAt`: we count distinct `brazeSendId` values where this field is set and `>= start of UTC day`.

**Response when limit is hit:**
```json
{ "ok": true, "processed": 0, "skipped": "daily_send_id_limit_reached", "limit": 900, "used": 900 }
```

---

## Schema

`UserDecision` fields relevant to this pipeline:

| Field | Type | Purpose |
|---|---|---|
| `brazeSendId` | `String?` | ID registered with Braze for analytics lookup |
| `brazeScheduleId` | `String?` | `schedule_id` from `/messages/schedule/create` (for debugging / future cancel) |
| `scheduledFor` | `DateTime?` | When Braze was scheduled to deliver |
| `reward` | `Float?` | Final reward applied to arm stats (positive = reward, negative = punishment) |
| `brazeAnalyticsFetchedAt` | `DateTime?` | When `/sends/data_series` was polled (used for daily cap) |

---

## Limitations & Migration Path

This approach has several known limitations:

1. **14-day data retention**: Braze only retains `/sends/data_series` data for 14 days. If the analytics cron doesn't run within 14 days of a send, the data is gone.
2. **Aggregated, not individual**: Engagement data is at the send-batch level, not per-user. A single `click_rate` is applied uniformly to all users in the group.
3. **No attribution across campaigns**: The reward is derived from the send's own engagement, not from downstream conversions (plan reads, app opens, etc.).
4. **900/day cap**: As the number of active agents and sends scales, this cap becomes constraining.

**Recommended replacement:** Configure Hightouch to sync Braze campaign analytics (or use Braze Currents → data warehouse → Hightouch) to deliver per-user conversion events to `POST /api/ingest/events`. This eliminates the cap, provides per-user attribution, and extends the attribution window beyond 14 days.
