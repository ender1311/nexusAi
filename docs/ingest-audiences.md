# POST /api/ingest/audiences

Syncs Braze cohorts into Nexus as user segments for agent targeting. This is the Braze audience equivalent of `/api/ingest/users`; use this when audience membership is Braze-authoritative and you want agents to send only to users in that cohort.

## Authentication

```
Authorization: Bearer <HIGHTOUCH_API_KEY>
```

Same API key as other ingest endpoints (`/api/ingest/events`, `/api/ingest/users`).

## Request Format

### Legacy batch (Braze cohort export)

```json
{
  "cohort_id": "string",
  "cohort_changes": [
    {
      "user_ids": ["string"],
      "braze_user_ids": ["string"]
    }
  ]
}
```

### Hightouch column mapping (recommended)

Map the Hightouch source column **`user_id`** (YouVersion numeric ID) to destination **`user_id`**, and add a static JSON field for **`cohort_id`** (the Braze cohort ID):

```json
{
  "cohort_id": "2f8c5a1b-e9d2-48f1-b6c7-3a4e9f2d1c5b",
  "user_id": "123456"
}
```

For batched rows, use a `users` array:

```json
{
  "cohort_id": "2f8c5a1b-e9d2-48f1-b6c7-3a4e9f2d1c5b",
  "users": [
    { "user_id": "123456" },
    { "user_id": "789012" }
  ]
}
```

Liquid templates: `docs/json/hightouch-audience-sync.json` (legacy batch) and `docs/json/hightouch-audience-sync-column-mapping.json` (column mapping with static `cohort_id` + mapped `user_id`).

Singular `user_id` is also accepted inside `cohort_changes`:

```json
{
  "cohort_id": "2f8c5a1b-e9d2-48f1-b6c7-3a4e9f2d1c5b",
  "cohort_changes": [{ "user_id": "123456" }]
}
```

### Field reference

- `cohort_id` — Required. Becomes the `segmentName` in the database. Use the Braze cohort ID directly.
- `user_id` / `user_ids` — YouVersion external_user_ids (same value Braze stores as `external_id`). Hightouch source column `user_id` maps here — **not** to `/api/ingest/users`'s `external_user_id` field name.
- `external_user_id` — Alias for `user_id` (singular only).
- `braze_user_id` / `braze_user_id_latest` / `braze_user_ids` — Braze internal IDs for users without a verified YouVersion external_user_id. Nexus creates unverified `TrackedUser` records (externalId = brazeId) and enrolls them. When identity is later resolved to a real external_user_id, the record is automatically promoted.

**Do not** map Hightouch `user_id` to `/api/ingest/users`'s `external_user_id` when syncing audiences — use this endpoint with `user_id` instead.

## Additive-Only Semantics

**This endpoint only ADDS members to a segment. It never removes users.** Users who no longer belong to the audience in Braze are not purged from the Nexus segment. If removal is required in the future, support must be added to this endpoint (e.g., explicit `removed_user_ids` field or a separate DELETE payload).

## Batch Limits

Maximum 10,000 total IDs (user_ids + braze_user_ids combined) per request. Larger cohorts should be split across multiple requests.

## Response

```json
{
  "ok": true,
  "cohort_id": "string",
  "received": number,
  "upserted": number,
  "skipped": number
}
```

- `received` — Total IDs in the request.
- `upserted` — IDs enrolled or updated in the segment.
- `skipped` — IDs already present in the segment or invalid.

## Agent Targeting

Cohorts land as `UserSegment` rows (`segmentName = cohort_id`). Two ways to target
them from an agent:

- **Multi-segment (current):** set `segmentTargeting = { includes: [...],
  excludes: [...] }`. `includes` are OR-matched against the user's `UserSegment`
  rows; `excludes` remove members. See `docs/nexus-agent-targeting-spec.md`.
- **Legacy single-segment:** set `targetSegmentName` to the `cohort_id` string.
  Used as the fallback when `segmentTargeting` is `null`.

Distinct segment names available for the targeting UI are served by
`GET /api/segments`.

## Example Request

```bash
curl -X POST https://nexus.youversion.com/api/ingest/audiences \
  -H "Authorization: Bearer YOUR_HIGHTOUCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "cohort_id": "2f8c5a1b-e9d2-48f1-b6c7-3a4e9f2d1c5b",
    "cohort_changes": [
      {
        "user_ids": ["123456", "789012"],
        "braze_user_ids": ["abc-def-ghi"]
      }
    ]
  }'
```

Returns `{ "ok": true, "cohort_id": "2f8c5a1b-...", "received": 3, "upserted": 3, "skipped": 0 }`.
