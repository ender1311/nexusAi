# POST /api/ingest/audiences

Syncs Braze cohorts into Nexus as user segments for agent targeting. This is the Braze audience equivalent of `/api/ingest/users`; use this when audience membership is Braze-authoritative and you want agents to send only to users in that cohort.

## Authentication

```
Authorization: Bearer <HIGHTOUCH_API_KEY>
```

Same API key as other ingest endpoints (`/api/ingest/events`, `/api/ingest/users`).

## Request Format

```json
{
  "cohort_id": "string",
  "cohort_changes": [
    {
      "user_ids": ["string"],                  // Optional: YouVersion external_user_ids
      "braze_user_ids": ["string"]             // Optional: Braze internal IDs (unverified users)
    }
  ]
}
```

- `cohort_id` — Becomes the `segmentName` in the database. Use the Braze cohort ID directly.
- `user_ids` — Array of YouVersion external_user_ids for verified users.
- `braze_user_ids` — Array of Braze internal IDs for users without a verified YouVersion external_user_id. Nexus creates unverified `TrackedUser` records (externalId = brazeId) and enrolls them. When identity is later resolved to a real external_user_id, the record is automatically promoted.

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

To target users in a cohort from an agent, set the agent's `targetSegmentName` property to the `cohort_id` string. The agent will only send to users enrolled in that segment.

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
