# Braze Integration

How Nexus communicates with the Braze CDP for message delivery and analytics.

## Architecture

```mermaid
graph TB
    subgraph NEXUS["Nexus (src/lib/braze/)"]
        BC["BrazeClient (client.ts)<br/>REST API wrapper<br/>Bearer token auth"]
        PF["PayloadFactory (payload-factory.ts)<br/>Builds channel-specific payloads"]
        BA["BrazeAnalytics (analytics.ts)<br/>Fetches campaign metrics"]
    end

    subgraph CONFIG["Configuration"]
        ENV["process.env<br/>BRAZE_API_KEY<br/>BRAZE_REST_URL"]
        APPSET["AppSetting table<br/>via /api/settings"]
        ENVIDS["process.env (or options)<br/>BRAZE_ANDROID_APP_ID<br/>BRAZE_IOS_APP_ID<br/>BRAZE_WEB_APP_ID"]
    end

    subgraph BRAZE_API["Braze REST API"]
        SEND["POST /messages/send<br/>Trigger message delivery"]
        CAMP["GET /campaigns/data_series<br/>Campaign analytics"]
        SENDS["GET /sends/data_series<br/>Per-send analytics"]
        SENDID["POST /sends/id/create<br/>Register send_id for tracking"]
    end

    ENV --> BC
    APPSET -.->|"manual env sync needed"| ENV
    ENVIDS --> PF
    BC --> SEND
    BC --> SENDID
    BA --> CAMP
    BA --> SENDS
    PF --> BC
```

## Payload Factory — Channel Payloads

```mermaid
flowchart TD
    PF([PayloadFactory]) --> AUDIENCE[buildAudience:<br/>external_user_ids list OR<br/>segment_id + broadcast=true]

    AUDIENCE --> PUSH[buildPushPayload]
    AUDIENCE --> EMAIL[buildEmailPayload]
    AUDIENCE --> SMS[buildSmsPayload]

    subgraph PUSH_DETAIL["Push Payload"]
        PUSH --> ANDROID["Android:<br/>alert (body text)<br/>title<br/>custom_uri (deeplink)<br/>image_url"]
        PUSH --> APPLE["Apple:<br/>alert (body text)<br/>custom_uri (deeplink)<br/>rich_notification (image)"]
    end

    subgraph EMAIL_DETAIL["Email Payload"]
        EMAIL --> EFIELDS["subject<br/>body (HTML)<br/>from_name<br/>from_email<br/>reply_to"]
    end

    subgraph SMS_DETAIL["SMS Payload"]
        SMS --> SFIELDS["message_body (text)"]
    end
```

## Analytics Fetch & Normalization

```mermaid
flowchart TD
    FETCH([BrazeAnalytics.fetch]) --> CAMPAIGN[GET /campaigns/data_series<br/>campaignId, sendId?, length]
    FETCH --> SEND_SERIES[GET /sends/data_series<br/>campaignId, sendId, length]

    CAMPAIGN --> AGG[aggregateDataSeries:<br/>Sum all time-point metrics]
    SEND_SERIES --> AGG

    AGG --> NORM[normalizeMetrics:<br/>sent / sends → unified sent<br/>opens / total_opens → unified opens<br/>compute open_rate = opens/sent<br/>compute click_rate = clicks/sent]

    NORM --> RESULT[Normalized metric object<br/>for reward ingestion]
```

## createBrazeClient — Graceful Degradation

```typescript
// src/lib/braze/client.ts
export function createBrazeClient(): BrazeClient | null {
  const apiKey = process.env.BRAZE_API_KEY
  const restUrl = process.env.BRAZE_REST_URL
  if (!apiKey || !restUrl) return null   // app runs without Braze
  return new BrazeClient(apiKey, restUrl)
}
```

If `BRAZE_API_KEY` or `BRAZE_REST_URL` are missing, all Braze calls are skipped
and the app continues to function for local dev / analytics-only use.

## Braze REST URL Normalization

The client strips any protocol prefix and re-adds `https://`:
```
"rest.iad-01.braze.com"      → "https://rest.iad-01.braze.com"
"https://rest.iad-01.braze.com" → "https://rest.iad-01.braze.com"
```

## Send ID Tracking

Nexus creates a unique `send_id` per campaign send via `POST /sends/id/create`.
The `brazeSendId` is then stored on `UserDecision` and `Message`/`MessageVariant`
records for per-send analytics attribution.

## Environment Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `BRAZE_API_KEY` | env / AppSetting | REST API authentication |
| `BRAZE_REST_URL` | env / AppSetting | API base URL (e.g. `rest.iad-01.braze.com`) |
| `BRAZE_ANDROID_APP_ID` | env / AppSetting | Android push app identifier |
| `BRAZE_IOS_APP_ID` | env / AppSetting | iOS push app identifier |
| `BRAZE_WEB_APP_ID` | env / AppSetting | Web push app identifier |
| `BRAZE_APP_GROUP_ID` | env / AppSetting | Braze workspace identifier |

> **Note:** `BrazeClient` reads from `process.env` at instantiation time. Settings saved via
> the UI persist to the `AppSetting` DB table but require a server restart or explicit env
> var injection to take effect in the running process.
