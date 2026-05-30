# Data Model

Entity-relationship diagram of all Prisma models.

```mermaid
erDiagram
    Agent {
        string id PK
        string name
        string description
        string status "draft | active | paused"
        string algorithm "thompson | epsilon_greedy | contextual"
        float epsilon "default 0.1"
        string funnelStage "wau | lapsed | connected | etc"
        json targetFilter "optional audience filter"
        int fallbackSendHour "0-23 UTC-naive; null = not set"
        int audienceCap "max users per cron run; null = unlimited"
        int uniqueUsersCap "lifetime distinct users cap; null = unlimited"
        string languageFilter "all | en | ISO prefix"
        int staleFunnelStageDays "null = no gate"
        int sortOrder "drag-and-drop display order; default 0"
        datetime createdAt
        datetime updatedAt
    }

    Goal {
        string id PK
        string agentId FK
        string eventName "e.g. plan_started"
        string tier "best|very_good|good|bad|very_bad|worst"
        float valueWeight "default 1.0"
        string weightMode "fixed | property"
        string weightProperty
        float weightDefault
        string description
    }

    Message {
        string id PK
        string agentId FK
        string name
        string channel "push | email | sms"
        string brazeCampaignId
        json testedVariables "array of variable names"
        datetime createdAt
    }

    MessageVariant {
        string id PK
        string messageId FK
        string name
        string subject
        string body
        string cta
        string status "active | paused"
        string brazeVariantId
        string title
        string iconImageUrl
        string deeplink
        int preferredHour
        string preferredDayOfWeek
        float frequencyCapOverride
        datetime createdAt
    }

    UserDecision {
        string id PK
        string agentId FK
        string userId FK
        string messageVariantId FK
        string channel
        datetime sentAt
        string brazeSendId
        string conversionEvent
        datetime conversionAt
        float reward
    }

    User {
        string id PK
        string externalId UK "from Hightouch"
        json attributes "arbitrary profile fields"
        int totalDecisions
        int totalConversions
        float totalReward
        json channelStats "{push/email/sms: {sent, converted}}"
        json hourlyStats "24-element array"
        json dailyStats "7-element array"
        json featureVector "37-float computed vector"
        datetime featureVectorAt
        string personaId FK
        float personaConfidence
        datetime personaAssignedAt
        datetime createdAt
        datetime updatedAt
    }

    Persona {
        string id PK
        string name
        string description
        string icon
        string color "Tailwind color name"
        string source "manual | discovered"
        json centroid "37-float cluster center"
        int clusterSize
        float silhouetteScore
        json traits "rich profile fields"
        string label
        json tags
        boolean isActive
        datetime discoveredAt
        datetime createdAt
        datetime updatedAt
    }

    AgentPersonaTarget {
        string id PK
        string agentId FK
        string personaId FK
    }

    PersonaArmStats {
        string id PK
        string personaId
        string agentId
        string variantId
        float alpha "Beta dist successes (default 1)"
        float beta "Beta dist failures (default 1)"
        int tries
        int wins
    }

    SchedulingRule {
        string id PK
        string agentId FK "unique — one per agent"
        json frequencyCap "{maxSends, period}"
        json quietHours "{start, end, timezone}"
        json blackoutDates "array of date strings"
        boolean smartSuppress
        float suppressThresh
    }

    ModelMetric {
        string id PK
        string agentId FK
        datetime timestamp
        json metrics "arbitrary metric snapshot"
    }

    AppSetting {
        string id PK
        string key UK
        string value
    }

    UserAgentAssignment {
        string id PK
        string externalUserId UK
        string agentId
        datetime startedAt
        int sendCount "sends made in this exploration window"
        datetime windowCompletedAt "null until window complete"
    }

    ProcessedEventId {
        string eventId PK "Hightouch event_id for idempotency"
        datetime createdAt
    }

    UserPreference {
        string id PK
        string workosUserId UK "WorkOS user id"
        string hiddenStats "JSON array of StatKey strings the user has hidden; default []"
        datetime createdAt
        datetime updatedAt
    }

    Agent ||--o{ Goal : "has"
    Agent ||--o{ Message : "has"
    Agent ||--o{ UserDecision : "tracks"
    Agent ||--o{ ModelMetric : "records"
    Agent ||--o| SchedulingRule : "has"
    Agent ||--o{ AgentPersonaTarget : "targets"

    Message ||--o{ MessageVariant : "has"
    MessageVariant ||--o{ UserDecision : "selected in"

    User ||--o{ UserDecision : "receives"
    User }o--o| Persona : "assigned to"

    Persona ||--o{ AgentPersonaTarget : "targeted by"
```

## JSON Field Schemas

### `User.channelStats`
```json
{
  "push":  { "sent": 12, "converted": 3 },
  "email": { "sent": 5,  "converted": 1 },
  "sms":   { "sent": 0,  "converted": 0 }
}
```

### `User.featureVector` — 37 dimensions
```
[0-2]   channel conversion rates (push, email, sms)
[3-26]  hour-of-day normalized histogram (24 dims)
[27-33] day-of-week normalized histogram (7 dims)
[34]    overall conversion rate
[35]    engagement frequency (log-scaled decisions/week)
[36]    average reward magnitude
```

### `SchedulingRule.frequencyCap`
```json
{ "maxSends": 2, "period": "week" }
```

### `Persona.traits` (rich discovered/manual fields)
```json
{
  "engagementLevel": "daily",
  "contentModes": ["text", "plans"],
  "ageRange": "25-34",
  "gender": "male",
  "conversionRate": 0.18,
  "churnRisk": "low",
  "ltv": 4.2
}
```
