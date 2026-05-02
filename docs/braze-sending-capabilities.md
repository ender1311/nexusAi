# Braze Sending Capabilities Reference

Source: `../beacon/src/lib/services/braze/`

## Channels Supported

| Channel | Braze Endpoint | Payload factory method |
|---------|---------------|----------------------|
| Push (iOS + Android) | `POST /messages/send` | `payloadFactory.push(msg)` |
| Push via Campaign | `POST /messages/send` | `payloadFactory.pushCampaign(msg, sendId)` |
| Email | `POST /messages/send` | `payloadFactory.email(msg, sendId)` |
| Content Card | `POST /messages/send` | `payloadFactory.contentCard(msg, sendId)` |

## Push Payload Structure

```json
{
  "app_group_id": "<BRAZE_APP_GROUP_ID>",
  "campaign_id": "<campaign_id>",
  "send_id": "<send_id>",
  "external_user_ids": ["<user_id>"],
  "messages": {
    "android_push": {
      "app_id": "<BRAZE_ANDROID_APP_ID>",
      "title": "...",
      "alert": "...",
      "custom_uri": "youversion://bible",
      "message_variation_id": "<variant_id>"
    },
    "apple_push": {
      "app_id": "<BRAZE_IOS_APP_ID>",
      "alert": {
        "title": "...",
        "body": "..."
      },
      "custom_uri": "youversion://bible",
      "message_variation_id": "<variant_id>"
    }
  }
}
```

**UTM params:** Beacon auto-appends `?utm_medium=push&utm_campaign={campaign_id}` to deep-links (only works on HTTP(S) links, not `youversion://` schemes — native schemes are passed through unchanged).

**Newsletter audience filter:** Beacon sends with an `audience` filter that requires `newsletter_push = true` OR `newsletter_push` does not exist. This respects user communication preferences.

## Email Payload Structure

```json
{
  "campaign_id": "...",
  "send_id": "...",
  "external_user_ids": ["..."],
  "messages": {
    "email": {
      "subject": "...",
      "from": "YouVersion <noreply@bible.com>",
      "reply_to": "...",
      "body": "<html>...</html>",
      "app_id": "<BRAZE_EMAIL_APP_ID>",
      "message_variation_id": "...",
      "headers": {
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "List-Unsubscribe": "<https://bible.com/unsubscribes/newsletter/tokens/{{custom_attribute.${notifications_token}}}>"
      }
    }
  }
}
```

## Content Card Payload Structure

```json
{
  "campaign_id": "...",
  "send_id": "...",
  "external_user_ids": ["..."],
  "messages": {
    "content_card": {
      "title": "...",
      "description": "...",
      "type": "CAPTIONED_IMAGE",
      "image_url": "...",
      "ios_uri": "...",
      "android_uri": "...",
      "web_uri": "...",
      "uri_text": "...",
      "pinned": false,
      "expire_at": "2026-05-01T00:00:00Z",
      "app_id": "<BRAZE_WEB_APP_ID>",
      "message_variation_id": "...",
      "extra": { "weight": 1 }
    }
  }
}
```

## Audience Targeting

Three audience types:
1. **`users`** — explicit `external_user_ids` list (Nexus primary approach)
2. **`segment`** — `segment_id` + `broadcast: true` + audience filter
3. **`connected_audience`** — `segment_id` from connected audience (computed)

For Nexus, use `audienceType: "users"` with `externalUserIds: [user.externalId]` — bandit already determined who gets what.

## Analytics API Calls

| Method | Endpoint | Use |
|--------|----------|-----|
| `fetchSendAnalytics(campaignId, sendId)` | `GET /sends/data_series` | Per-send metrics (max 14 days) |
| `fetchCampaignAnalytics(campaignId, sendId?)` | `GET /campaigns/data_series` | Campaign aggregate (up to 30 days) |
| `fetchCampaignDetails(campaignId)` | `GET /campaigns/details` | Campaign metadata |
| `fetchCampaignList()` | `GET /campaigns/list` | All campaigns (paginated) |
| `fetchCanvasAnalytics(canvasId)` | `GET /canvas/data_series` | Canvas aggregate |
| `fetchCanvasDetails(canvasId)` | `GET /canvas/details` | Canvas variants + steps |
| `fetchCanvasList()` | `GET /canvas/list` | All canvases (paginated) |
| `fetchSegmentDetails(segmentId)` | `GET /segments/details` | Segment info |

## Normalized Metrics (from `BrazeAnalytics.normalizeMetrics`)

```
sent, delivered, unique_recipients,
unique_opens, total_opens, direct_opens, influenced_opens,
unique_clicks, clicks,
bounces, unsubscribes, spam_reports, machine_opens,
conversions, conversions1, conversions2, conversions3,
open_rate (%), click_rate (%)
```

**Important field aliases to know:**
- `/sends/data_series` returns `deliveries` (not `delivered`) — normalized handles both
- `sends` alias for `sent` — normalized handles both
- Apple MPP opens: both `machine_opens` and `machine_amp_open` used — summed

## Scheduling Messages

Instead of immediate send (`POST /messages/send`), use `POST /messages/schedule/create`:

```json
{
  "campaign_id": "...",
  "send_id": "...",
  "schedule": {
    "time": "2026-05-01T09:00:00",
    "in_local_time": true
  },
  "messages": { ... }
}
```

Or use Braze Intelligent Timing (optimal per-user send time):
```json
"schedule": {
  "time": "2026-05-01T09:00:00",
  "at_optimal_time": true
}
```

Cancel a scheduled send: `POST /messages/schedule/delete` with `schedule_id`.

Check if scheduled message still exists: `GET /messages/scheduled_broadcasts`.

**For Nexus smart send timing:** Use `in_local_time: true` with a per-user computed hour to approximate personalized timing. True optimal timing requires `at_optimal_time: true` (Braze Intelligence).

## User Lookup

Look up a Braze `external_id` by email: `GET /users/export/ids?email=...`

## Creating a Send ID

Before sending, create a send ID with Braze to enable per-send analytics:

```typescript
const sendId = await brazeClient.createSendId(campaignId, "nexus");
// Returns "nexus_abc12345" or null if campaign not found
```

Send ID is then passed to `pushCampaign(msg, sendId)` and stored in `UserDecision.brazeSendId` for later analytics retrieval.

## How Nexus Uses This

Nexus's `src/lib/braze/` mirrors beacon's client/payload-factory pattern.

To retrieve open/click rates for a variant decision:
```typescript
// Nexus BrazeAnalytics.fetchSendAnalytics
const metrics = await analytics.fetchSendAnalytics(
  message.brazeCampaignId,
  decision.brazeSendId
);
// Returns: { unique_opens, unique_clicks, sent, click_rate, open_rate, ... }
```

Use `click_rate` and `open_rate` as supplementary reward signals fed into `/api/ingest/events`.
