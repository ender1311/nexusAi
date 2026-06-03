# Hightouch → Nexus Sync Configuration

## Destination

- **Type:** HTTP Request
- **Name:** HTTP Request (slug: `http-request`)
- **Base URL:** `https://nexus.youversion.com`
- **Auth:** HTTP header `X-Hightouch-Token: <INGEST_API_KEY>`
- **Token fetch:** OFF (not needed — static Bearer token)
- **Hightouch auth method:** Basic Auth is okay if Hightouch requires a choice; Nexus ignores it and reads `X-Hightouch-Token`.

## Sync A: User Profiles

- **Source audience:** New Users within the last 28 Days (or similar broad audience)
- **Destination endpoint:** `POST /api/ingest/users`
- **Triggers:** Rows added + Rows changed
- **Batching:** 100 rows per request
- **Payload format:** JSON — Use JSON editor (Liquid template)
- **Initial sync:** Backfill all rows
- **Error handling:** Retry immediately with split retries
- **Timeout:** 30 seconds
- **Rate limit:** None
- **Schedule:** Once per hour

### Key column mappings

| Hightouch column | Payload field |
|---|---|
| `USER_ID` | `external_user_id` (required) |
| `funnel_stage` | `funnel_stage` (top-level — drives persona assignment override) |
| `first_name` | `attributes.first_name` |
| `last_name` | `attributes.last_name` |
| `email` | `attributes.email` |
| `LAST_SEEN_TIMESTAMP` | `attributes.last_seen_at` |
| `LANGUAGE_TAG` | `attributes.language_tag` |
| `PLAN_LOCALE_LATEST` | `attributes.plan_locale` |
| `TEXT_BIBLE_VERSION_ID_LATEST` | `attributes.preferred_bible_version_id` |
| `DONOR_ALIAS_IDS_ALL` | `attributes.donor_alias_ids` |
| `SOURCE_APPLICATION` | `attributes.source_application` |
| `VERIFIED_FLAG` | `attributes.verified` |
| `SUSPENDED_TIMESTAMP` | `attributes.suspended_at` (raw timestamp string, null if not suspended) |
| Trait: Preferred Channel Overall 30 Days | `attributes.preferred_channel_overall_30_days` |
| Trait: Preferred Channel Overall 90 Days | `attributes.preferred_channel_overall_90_days` |
| Trait: Preferred Channel External 30 Days | `attributes.preferred_channel_external_30_days` |
| Trait: Preferred Channel External 90 Days | `attributes.preferred_channel_external_90_days` |
| Trait: Has Active Recurring Gift to the YouVersion Fund | `attributes.has_recurring_gift` |
| Trait: Gifts Given within the past 3 to 36 Months | `attributes.gifts_count_3_36mo` |

### Liquid template

See `hightouch-ingest-users-payload.json` in this directory.

> **Hightouch Liquid gotcha:** The `present` filter is not supported. For nullable fields, store the raw value as a string (e.g. `suspended_at`) instead of trying to coerce to boolean.

## Sync B: Conversion events

- **Destination endpoint:** `POST /api/ingest/events`
- **Triggers:** Rows added (or per your Lightning / sync design)
- **Batching:** ≤ 1000 events per request
- **Required fields per event:** `event_id`, `event_name`, `external_user_id`, `occurred_at` (ISO 8601)
- **Liquid template:** `hightouch-push-open-events-payload.json` (push opens from `braze_user_id`, `user_id`, `timezone`, `event_timestamp`)

  ```json
  {
    "events": [
      {
        "event_id": "...",
        "event_name": "push_open",
        "external_user_id": "...",
        "occurred_at": "2026-05-10T12:34:56.000Z",
        "properties": { "timezone": "America/Chicago" }
      }
    ]
  }
  ```

## Funnel Stage → Persona Rules

| `funnel_stage` value | Persona assigned |
|---|---|
| `lapsed` | Returning (Re-engager) — overrides classifier |
| `lapsed_mau` | Returning (Re-engager) — overrides classifier |
| any other value | Determined by `classifyPersona()` based on plan history |

## Notes

- `user_id` (lowercase) is the YouVersion numeric user ID (e.g. `162218606`) — this must match the `external_id` used in Braze
- `HIGHTOUCH_USER_ID` (e.g. `ht182237868`) is Hightouch's internal synthetic key — do NOT use this as `external_user_id`
- Profile columns are **all lowercase** in this model: `user_id`, `first_name`, `last_name`, `email`, `last_seen_timestamp`, `language_tag`, `plan_locale_latest`, `text_bible_version_id_latest`, `donor_alias_ids_all`, `source_application`, `verified_flag`, `suspended_timestamp`
- Trait columns use title case with spaces (e.g. `Preferred Channel Overall 30 Days`) — use Hightouch's variable picker to confirm exact names
- `donor_alias_ids_all` must be quoted as a string (`"{{ row['donor_alias_ids_all'] }}"`) — some users have multiple IDs; unquoted comma-separated values break JSON parsing
- Hightouch Liquid does NOT support the `present` filter — store nullable timestamps as raw strings, not booleans
- Neon DB: project `solitary-cherry-26476014` (display name: `neon-coquelicot-candle`), endpoint `ep-old-surf-a4p5os6s`, pooler URL in use. Auto-suspend disabled.
