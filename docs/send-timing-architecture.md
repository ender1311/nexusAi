# Send Timing Architecture

## 1. Overview

Nexus sends push notifications through Braze using a daily midnight UTC cron. For each active agent, it selects a message variant per user (via Thompson Sampling or ε-Greedy), schedules the send through Braze's `/messages/schedule/create` API, and records a `UserDecision`. The timing of each send is derived from the user's historical session patterns.

## 2. Current timing strategy

### How per-user send times are computed

- Hightouch syncs `LAST_SEEN_TIMESTAMP` → `TrackedUser.preferredSendHour` (UTC hour) and `TrackedUser.preferredSendMinute` (UTC minute)
- Because `LAST_SEEN_TIMESTAMP` is a UTC timestamp, storing the UTC hour/minute implicitly captures the user's local time without needing to know their timezone explicitly. A user in EST who last used the app at 8:10am EST has `preferredSendHour=13` (13:00 UTC = 8am EST).
- The cron schedules a push 10 minutes before the preferred UTC time (e.g. preferredHour=13, preferredMinute=10 → scheduled at 13:00 UTC = 8:00am EST for that user). This uses total-minutes arithmetic to handle minute < 10 correctly.
- Cross-timezone global coverage: since the cron runs at midnight UTC and schedules sends throughout the day using Braze's scheduled send API, no 24/7 cron is needed. A single daily cron schedules sends for all timezones.

### Fallback timing (no session history)

- Users without `last_seen_at` data get an agent-configurable fallback hour (default: 8, range: 0–23).
- The fallback time is sent to Braze with `in_local_time: true` in the schedule object — Braze delivers at that hour in each user's own timezone.
- The agent can override the fallback hour per-agent via the Scheduling tab UI.
- If the fallback time has already passed when the cron runs (e.g. cron runs at 0:30 UTC and fallbackSendHour=0), the send is pushed to the same time the next day.

### Cron schedule

`0 0 * * *` (midnight UTC) — runs once daily.

## 3. Segment-based agent configuration

Agents should be configured to target specific funnel stages. The system currently assumes all users in the database are non-habitual-DEU (using the app 3 days/week or less). Future Hightouch data will include explicit funnel stage per user.

Recommended agent setup:

| Agent | funnelStage | frequencyCap | Target | Goal |
|-------|------------|--------------|--------|------|
| Lapsed Re-engagement | lapsed | 2x/week | Last seen 30+ days | First session → DAU |
| MAU Nudge | connected | 3x/week | 1–3 sessions/month | Increase session frequency |
| DAU Activation | activated | 5x/week | 3–5 sessions/week | → Habitual DEU habit |

Habitual DEU users (5-7 sessions/week) should not be targeted — they are already at the goal.

## 4. Session suppression (current limitation)

Ideally, a user who has already had an app session on the send day should not receive a push. The current implementation does not perform same-day session suppression because:

- Hightouch syncs `last_seen_at` on a batch schedule (not real-time)
- At midnight UTC cron time, `last_seen_at` reflects yesterday's session data
- The scheduled send goes out hours later with no way to cancel it per-user

**Workaround:** The 10-minute pre-session timing means the push arrives just before the user's typical session window, so many users receive the push before their next organic session anyway.

**Future fix:** When Hightouch syncs real-time events, add a pre-send suppression check: skip users where `last_seen_at >= today_start` at scheduling time.

## 5. Quiet hours (current limitation)

Quiet hours (10pm–4am user local time) require knowing each user's timezone. Currently we do not store user timezone — the `last_seen_at` UTC timestamp is our only timing signal.

**Current workaround:** The preferred-time approach naturally avoids nighttime sends because users whose last session was at 2am will have sends scheduled around 1:50am UTC, which may be inappropriate for other timezone users. This is a known imprecision.

**Future fix:** When Hightouch provides `last_known_timezone` or a preferred-location attribute, use it to:
1. Implement true quiet hours (skip sends between 10pm–4am user local time)
2. Enable `quietHours.timezone = "user"` in scheduling rules
3. Let Braze enforce quiet hours per recipient via the `in_local_time` + quiet hours API flags

## 6. Known limitations summary

| Limitation | Impact | Future fix |
|-----------|--------|-----------|
| No same-day session suppression | Users who open the app before their send time still receive a push | Real-time Hightouch sync → suppress if `last_seen_at >= today_start` |
| No user timezone stored | Quiet hours are approximate; fallback time is "best effort" local | Add `last_known_timezone` from Hightouch or Braze |
| Hightouch funnel stage not yet synced | Cannot segment by DAU/MAU/lapsed dynamically | Hightouch to sync funnel_stage → `TrackedUser.attributes` → funnelStage targeting |
| `preferredSendHour` derived from single last_seen_at | Noisy signal; first sync is always this user's session end | Accumulate hourly stats over time; use mode of last N sessions |
| No scheduled send confirmation | `UserDecision.scheduledFor` shows when we called Braze, not delivery confirmation | Ingest Braze delivery webhooks |

## 7. Data flow diagram (ASCII)

```
Hightouch (nightly sync)
  └─ LAST_SEEN_TIMESTAMP → TrackedUser.preferredSendHour + preferredSendMinute

Daily cron (00:00 UTC)
  └─ For each active agent:
      ├─ Lottery/in-window user selection (Thompson Sampling / ε-Greedy)
      ├─ computeScheduledAt(preferredHour, preferredMinute, agentFallbackHour)
      │   ├─ Has preferred time + still future? → schedule at (UTC preferred - 10min), in_local_time=false
      │   └─ Fallback → schedule at agentFallbackHour:00 today (tomorrow if past), in_local_time=true
      ├─ Group users by (variantId × scheduledAt × inLocalTime)
      ├─ POST /messages/schedule/create to Braze (50 concurrent)
      └─ UserDecision created with scheduledFor = computed send time

Braze
  └─ Delivers push at scheduled time (in user's local time if in_local_time=true)
```
