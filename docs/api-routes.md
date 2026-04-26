# API Routes

All REST endpoints in `src/app/api/`.

```mermaid
graph LR
    subgraph Agents["/api/agents"]
        A1["GET /api/agents<br/>List all with goals, messages,<br/>scheduling, decision counts"]
        A2["POST /api/agents<br/>Create agent + goals + messages"]
        A3["GET /api/agents/:id<br/>Single agent detail"]
        A4["PATCH /api/agents/:id<br/>Update name/desc/status/algorithm/epsilon"]
        A5["DELETE /api/agents/:id<br/>Cascade delete goals/messages/decisions"]
    end

    subgraph Goals["/api/agents/:id/goals"]
        G1["GET — list goals for agent"]
        G2["POST — create single goal"]
        G3["PUT — replace all goals (bulk)"]
    end

    subgraph Messages["/api/agents/:id/messages"]
        M1["GET — list messages with variants"]
        M2["POST — create message + variants"]
        M3["PUT — update message"]
    end

    subgraph Metrics["/api/agents/:id/metrics"]
        ME1["GET — last 100 ModelMetric records<br/>ordered by timestamp desc"]
    end

    subgraph Personas["/api/personas"]
        P1["GET /api/personas<br/>List active with user counts"]
        P2["POST /api/personas<br/>Create manual persona"]
        P3["GET /api/personas/:id"]
        P4["PUT /api/personas/:id<br/>Update persona fields"]
        P5["DELETE /api/personas/:id<br/>Soft delete — sets isActive=false"]
        P6["POST /api/personas/discover<br/>Trigger k-means clustering<br/>+ batch user assignment"]
    end

    subgraph Ingest["/api/ingest"]
        I1["POST /api/ingest/events<br/>Hightouch conversion events<br/>Auth: Bearer HIGHTOUCH_API_KEY"]
        I2["POST /api/ingest/users<br/>Hightouch user profiles<br/>Auth: Bearer HIGHTOUCH_API_KEY"]
    end

    subgraph Settings["/api/settings"]
        S1["GET — key-value map of all settings"]
        S2["POST — upsert one or more settings"]
    end
```

## Request / Response Shapes

### POST /api/agents
```typescript
// Request
{
  name: string
  description?: string
  algorithm?: "thompson" | "epsilon_greedy" | "contextual"
  epsilon?: number
  goals?: Array<{
    eventName: string
    tier: "best" | "very_good" | "good" | "bad" | "very_bad" | "worst"
    valueWeight?: number
    weightMode?: "fixed" | "property"
    weightProperty?: string
    weightDefault?: number
    description?: string
  }>
  messages?: Array<{
    name: string
    channel: "push" | "email" | "sms"
    brazeCampaignId?: string
    testedVariables?: string[]
    variants?: Array<{
      name: string
      subject?: string
      body?: string
      cta?: string
      title?: string
      deeplink?: string
    }>
  }>
}

// Response: Agent object with nested goals, messages, schedulingRule
```

### POST /api/ingest/events
```typescript
// Headers: Authorization: Bearer <HIGHTOUCH_API_KEY>
// Request
{
  events: Array<{
    externalId: string       // matches User.externalId
    name: string             // e.g. "plan_started"
    timestamp: string        // ISO 8601
    properties?: Record<string, unknown>
  }>
}

// Response
{ processed: number, matched: number, errors: string[] }
```

### POST /api/ingest/users
```typescript
// Headers: Authorization: Bearer <HIGHTOUCH_API_KEY>
// Request
{
  users: Array<{
    externalId: string
    attributes?: Record<string, unknown>
  }>
}

// Response
{ updated: number, errors: string[] }
```

### POST /api/personas/discover
```typescript
// Request
{
  minK?: number          // default 3
  maxK?: number          // default 15
  minInteractions?: number  // default 20 — minimum decisions to include user
}

// Response
{
  personas: Persona[]
  usersAssigned: number
  silhouetteScore: number
}
```

### GET /api/settings
```typescript
// Response
{
  BRAZE_API_KEY: string
  BRAZE_REST_URL: string
  BRAZE_ANDROID_APP_ID: string
  BRAZE_IOS_APP_ID: string
  BRAZE_WEB_APP_ID: string
  BRAZE_APP_GROUP_ID: string
  // ...any other stored keys
}
```

## Authentication

| Route group | Auth method |
|-------------|-------------|
| `/api/ingest/*` | `Authorization: Bearer <HIGHTOUCH_API_KEY>` env var |
| All others | None (internal / assumed network-secured) |
