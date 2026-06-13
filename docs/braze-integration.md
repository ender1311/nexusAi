# Braze Integration

How Nexus communicates with the Braze CDP for message delivery and analytics.

## Architecture

```mermaid
graph TB
    subgraph NEXUS["Nexus (src/lib/braze/)"]
        BC["BrazeClient (client.ts)<br/>REST wrapper · Bearer auth<br/>10s AbortController timeout"]
        PF["PayloadFactory (payload-factory.ts)<br/>Builds channel-specific payloads"]
        BA["BrazeAnalytics (analytics.ts)<br/>Fetches campaign / send metrics"]
    end

    subgraph CONFIG["Configuration"]
        ENV["process.env<br/>BRAZE_API_KEY<br/>BRAZE_REST_ENDPOINT"]
        APPSET["AppSetting table<br/>via /api/settings (UI edits)"]
        ENVIDS["process.env<br/>BRAZE_NEXUS_CAMPAIGN_ID<br/>BRAZE_NEXUS_*_VARIANT_ID"]
    end

    subgraph BRAZE_API["Braze REST API"]
        SEND["POST /messages/send<br/>Immediate delivery"]
        SCHED["POST /messages/schedule/create<br/>Future delivery (returns schedule_id)"]
        CC_SEND["POST /campaigns/trigger/send<br/>API-triggered content card"]
        CC_SCHED["POST /campaigns/trigger/schedule/create<br/>Scheduled content card"]
        CANVAS_SEND["POST /canvas/trigger/send<br/>Canvas-triggered slideup"]
        CANVAS_SCHED["POST /canvas/trigger/schedule/create<br/>Scheduled slideup"]
        CAMP["GET /campaigns/data_series<br/>Campaign analytics"]
        SENDS["GET /sends/data_series<br/>Per-send analytics"]
    end

    ENV --> BC
    APPSET -.->|"manual env sync needed"| ENV
    ENVIDS --> PF
    BC --> SEND
    BC --> SCHED
    BA --> CAMP
    BA --> SENDS
    PF --> BC
```

## Send model — all sends attributed to one Nexus campaign

Every Nexus send targets a **single Braze campaign** (`BRAZE_NEXUS_CAMPAIGN_ID`)
with per-channel message variations (`BRAZE_NEXUS_IOS_VARIANT_ID`,
`BRAZE_NEXUS_ANDROID_VARIANT_ID`, `BRAZE_NEXUS_EMAIL_VARIANT_ID`,
`BRAZE_NEXUS_CONTENTCARD_VARIANT_ID`). The bandit's chosen copy is injected into
the payload at send time; Braze analytics roll up under this one campaign.

The cron groups decisions by `(variantId × scheduledAt × inLocalTime)` and routes
each group to the right endpoint (`src/lib/cron/send-grouping.ts`):

- **Future send time** → `POST /messages/schedule/create` with
  `schedule: { time }`. The returned `schedule_id` is stored on
  `UserDecision.brazeScheduleId`.
- **Immediate** → `POST /messages/send`.

### `brazeSendId` is a local marker, not a Braze send_id

Nexus does **not** call `/sends/id/create`. It generates a local
`randomUUID()` and stores it on the batch's `UserDecision` rows as an
"accepted by Braze" marker (used by the analytics cron's daily-cap counter).
The real Braze `send_id` is auto-assigned by Braze and arrives back via Braze
Currents at `POST /api/ingest/braze-events` — the **primary reward path**.

## Payload Factory — Channel Payloads

`PayloadFactory` exposes dedicated builders per channel. All builders attach
`in_local_time: true` when the group was scheduled in local-time fallback mode.

```mermaid
flowchart TD
    PF([PayloadFactory]) --> AUDIENCE[buildAudience:<br/>external_user_ids OR braze_id list]

    AUDIENCE --> PUSH[buildPushPayload]
    AUDIENCE --> EMAIL[buildEmailPayload]
    AUDIENCE --> CC[buildContentCardApiTriggerPayload]
    AUDIENCE --> CANVAS[buildCanvasApiTriggerPayload]
    AUDIENCE --> OTHER[buildSmsPayload<br/>generic message_body fallthrough]

    subgraph PUSH_DETAIL["Push Payload → /messages/send"]
        PUSH --> ANDROID["Android: alert (body), title,<br/>custom_uri (deeplink), image_url"]
        PUSH --> APPLE["Apple: alert (body),<br/>custom_uri (deeplink), rich image"]
    end

    subgraph EMAIL_DETAIL["Email Payload → /messages/send"]
        EMAIL --> EFIELDS["subject, body (HTML),<br/>from / reply_to"]
    end

    subgraph CC_DETAIL["Content Card → /campaigns/trigger/send (or schedule/create)"]
        CC --> CC_TP["trigger_properties:<br/>title, message, cta, link<br/>Campaign: BRAZE_CONTENT_CARD_CAMPAIGN_ID"]
    end

    subgraph CANVAS_DETAIL["Slideup → /canvas/trigger/send (or schedule/create)"]
        CANVAS --> CANVAS_EP["canvas_entry_properties:<br/>slideupOnly, title?, message, link?, imageUrl?<br/>Canvas: BRAZE_NEXUS_SLIDEUP_CANVAS_ID"]
    end
```

> **Message channels** are `push | email | in-app | content-card` (the
> `Message.channel` enum). The send grouping routes:
> - `push` → `buildPushPayload` → `POST /messages/send` (or `/messages/schedule/create`)
> - `email` → `buildEmailPayload` → `POST /messages/send` (or `/messages/schedule/create`)
> - `content-card` → `buildContentCardApiTriggerPayload` → `POST /campaigns/trigger/send`
>   (or `/campaigns/trigger/schedule/create`). Campaign: `BRAZE_CONTENT_CARD_CAMPAIGN_ID`.
>   The campaign template resolves `{{api_trigger_properties.${title}}}`, `${message}`, `${cta}`, `${link}`.
> - `in-app` → `buildCanvasApiTriggerPayload` → `POST /canvas/trigger/send`
>   (or `/canvas/trigger/schedule/create`). Canvas: `BRAZE_NEXUS_SLIDEUP_CANVAS_ID`.
>   Canvas entry properties: `slideupOnly` (derived from `title === null`), `title`, `message`, `link`, `imageUrl`.
>   The canvas Decision Split routes `slideupOnly=true` to slideup-only step, `false` to push-then-slideup.
> - everything else → `buildSmsPayload` (generic body fallthrough)

## Analytics Fetch & Normalization

`BrazeAnalytics` (used by the `ingest-braze-analytics` decay sweep, not the
primary reward path) reconciles Braze's inconsistent field names.

```mermaid
flowchart TD
    FETCH([BrazeAnalytics.fetch]) --> CAMPAIGN[GET /campaigns/data_series]
    FETCH --> SEND_SERIES[GET /sends/data_series]

    CAMPAIGN --> AGG[aggregateDataSeries:<br/>sum all time-point metrics]
    SEND_SERIES --> AGG

    AGG --> NORM[normalizeMetrics:<br/>sent OR sends → unified sent<br/>direct_opens vs total_opens distinguished<br/>open_rate = opens / sent<br/>click_rate = clicks / sent]

    NORM --> RESULT[Normalized metric object]
```

> Braze returns send counts under either `sent` or `sends` within the same
> response, and reports `direct_opens` separately from `total_opens` — the
> normalizer checks both to avoid silently dropping metrics.

## createBrazeClient — Graceful Degradation

```typescript
// src/lib/braze/client.ts
export function createBrazeClient(): BrazeClient | null {
  const apiKey = process.env.BRAZE_API_KEY;
  const restUrl = process.env.BRAZE_REST_ENDPOINT ?? process.env.BRAZE_REST_URL;
  if (!apiKey || !restUrl) return null;   // app runs without Braze
  return new BrazeClient(apiKey, restUrl);
}
```

If `BRAZE_API_KEY` or the REST endpoint is missing, `createBrazeClient` returns
`null` and all Braze calls are skipped — the app keeps working for local dev and
analytics-only use. `BRAZE_REST_ENDPOINT` is the canonical key; `BRAZE_REST_URL`
remains a legacy fallback.

## REST endpoint normalization & timeouts

`BrazeClient` prefixes a bare host with `https://` and strips a trailing slash
(`rest.iad-01.braze.com` → `https://rest.iad-01.braze.com`). Both `post()` and
`get()` wrap each request in a **10-second `AbortController` timeout** with
`finally` cleanup, so a hung Braze call can't stall an ingest or cron path.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BRAZE_API_KEY` | REST API authentication |
| `BRAZE_REST_ENDPOINT` | API base (e.g. `rest.iad-01.braze.com`); `BRAZE_REST_URL` is a legacy fallback |
| `BRAZE_NEXUS_CAMPAIGN_ID` | The single campaign all Nexus sends are attributed to |
| `BRAZE_NEXUS_IOS_VARIANT_ID` | iOS push message variation within the Nexus campaign |
| `BRAZE_NEXUS_ANDROID_VARIANT_ID` | Android push message variation |
| `BRAZE_NEXUS_EMAIL_VARIANT_ID` | Email message variation |
| `BRAZE_NEXUS_CONTENTCARD_VARIANT_ID` | Content-card message variation |
| `BRAZE_CONTENT_CARD_CAMPAIGN_ID` | API-triggered content card campaign (required for `in-app` channel sends) |
| `BRAZE_NEXUS_SLIDEUP_CANVAS_ID` | Canvas ID for slideup sends (required for `in-app` channel sends) |
| `BRAZE_ANDROID_APP_ID` / `BRAZE_IOS_APP_ID` / `BRAZE_WEB_APP_ID` | Optional platform app identifiers used in push payload construction |

> **Config source:** `BrazeClient` reads from `process.env` at instantiation.
> Settings saved via the UI persist to the `AppSetting` table but require a server
> restart or explicit env sync to take effect in the running process.
