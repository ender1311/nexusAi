# Data Model

Entity-relationship diagram of the Prisma models. The schema lives in `prisma/schema.prisma`.

> **Naming note:** the YouVersion app-user model is `TrackedUser` in Prisma but is mapped to
> the existing **`User`** database table via `@@map("User")`. Several models reference a user
> by `externalId`/`userId` **without a foreign key** on purpose (e.g. `UserDecision.userId`,
> `UserArmStats.userId`, `UserAgentAssignment.externalUserId`, `UserSegment.externalId`,
> `TrackedUser.lockedByAgentId`) so the rows survive agent soft-deletes and user re-keying.

## Core campaign + messaging

```mermaid
erDiagram
    Agent {
        string id PK
        string name
        string description
        string status "draft | active | paused"
        string algorithm "thompson | epsilon_greedy | linucb"
        float epsilon "default 0.1"
        string funnelStage "wau | lapsed | connected | ... (default wau)"
        json targetFilter "optional audience filter"
        string targetSegmentName "legacy single include segment"
        json segmentTargeting "{ includes: string[], excludes: string[] } or null"
        int fallbackSendHour "0-23 UTC-naive; delivered in_local_time"
        int audienceCap "max users per cron run; null = unlimited"
        int uniqueUsersCap "lifetime distinct users cap; null = unlimited"
        int dailySendCap "max sends per UTC day; null = unlimited"
        string languageFilter "all | en | ISO prefix"
        boolean localizePush "opt-in localized push; default false"
        int staleFunnelStageDays "null = no staleness gate"
        string color "hex accent, default #6366f1"
        int sortOrder "drag-and-drop order; default 0"
        int holdMaxDays "auto-release after N days owned; default 90"
        int holdMaxSends "auto-release after N sends; default 24"
        datetime createdAt
        datetime updatedAt
    }

    Goal {
        string id PK
        string agentId FK
        string eventName "e.g. plan_started, gift_given, funnel_recovery"
        string tier "best|very_good|good|bad|very_bad|worst"
        float valueWeight "default 1.0"
        string weightMode "fixed | property"
        string weightProperty
        float weightDefault "default 1.0"
        string description
    }

    Message {
        string id PK
        string agentId FK
        string name
        string channel "push | email | in-app | content-card"
        string brazeCampaignId
        string brazeCanvasId "Braze canvas UUID"
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
        string brazeCanvasStepId
        string title
        string iconImageUrl
        string deeplink
        int preferredHour
        int preferredDayOfWeek
        json frequencyCapOverride
        datetime warmupUntil
        string category
        string subcategory
        string sourceTemplateId FK "self-ref: TemplateClones"
        json actionFeatures "tone/personalization/ctaType/length descriptor"
        datetime createdAt
    }

    MessageVariantTranslation {
        string id PK
        string messageVariantId FK
        string language "canonical: es, pt, fr, zh_CN ... (never en)"
        string title
        string body
        string bodyPersonal
        string status "default active"
        string source "import:dropbox | upload | manual"
        string sourceFile
    }

    Deeplink {
        string id PK
        string wayfinderId UK
        string category "reader | plans | votd | guided-scripture | guided-prayer"
        string subcategory
        string label
        string urlTemplate
        int sortOrder
    }

    Agent ||--o{ Goal : "has"
    Agent ||--o{ Message : "has"
    Message ||--o{ MessageVariant : "has"
    MessageVariant ||--o{ MessageVariantTranslation : "localized by"
    MessageVariant ||--o{ MessageVariant : "cloned from (template)"
```

## Users, personas, and bandit arms

```mermaid
erDiagram
    TrackedUser {
        string id PK
        string externalId UK "from Hightouch"
        json attributes "Hightouch profile fields"
        int totalDecisions
        int totalConversions
        float totalReward
        json channelStats "{push/email/...: {sent, converted}}"
        json hourlyStats "24-element array"
        json dailyStats "7-element array"
        int preferredSendHour "0-23 UTC from last_seen_at"
        int preferredSendMinute "0-59 UTC"
        string timezone "IANA tz synced from Braze"
        json featureVector "10-float computed vector"
        datetime featureVectorAt
        string brazeId UK "Braze internal id; unverified users keyed on this"
        string funnelStage "lapsed | connected | new_user | ... | null"
        datetime funnelStageUpdatedAt "drives cron staleness gate"
        string lockedByAgentId "cron send lock; null = unlocked"
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
        string icon "default Users2"
        string color "Tailwind color name; default blue"
        string source "manual | discovered"
        json centroid "10-float cluster center"
        int clusterSize
        float silhouetteScore
        json traits "rich profile fields"
        string label
        json tags
        boolean isActive
        datetime discoveredAt
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
        float alpha "default 1.0"
        float beta "default 1.0"
        int tries
        int wins
    }

    UserArmStats {
        string id PK
        string userId "TrackedUser.externalId (no FK)"
        string agentId
        string variantId
        float alpha "default 1.0"
        float beta "default 30.0 (pessimistic prior)"
        int tries
        int wins
    }

    LinUCBArm {
        string id PK
        string agentId
        string variantId
        json aInv "flattened d×d inverse design matrix"
        json b "d-float reward vector"
        int tries
    }

    TrackedUser }o--o| Persona : "assigned to"
    Persona ||--o{ AgentPersonaTarget : "targeted by"
```

Bandit arms are **not** linked by Prisma relations — they are keyed tuples:
`PersonaArmStats(personaId, agentId, variantId)`, `UserArmStats(userId, agentId, variantId)`,
`LinUCBArm(agentId, variantId)`. See `docs/bandit-engine.md` for how they're read, blended,
and updated.

## Decisions, ownership, and funnel recovery

```mermaid
erDiagram
    UserDecision {
        string id PK
        string agentId FK
        string userId "TrackedUser.externalId (no FK)"
        string messageVariantId FK "nullable"
        string channel
        datetime sentAt "default now()"
        string brazeSendId "locally-generated UUID"
        string brazeScheduleId "from /messages/schedule/create"
        datetime scheduledFor "delivery anchor; null = immediate"
        string conversionEvent
        datetime conversionAt
        datetime pushOpenAt "push open without consuming conversionAt"
        float reward
        float conversionValue "USD gift amount for gift_given; else null"
        datetime brazeAnalyticsFetchedAt "last /sends/data_series poll"
        json decisionContext "giver_tier/streak/recency/trigger snapshot"
    }

    UserAgentAssignment {
        string id PK
        string externalUserId UK "TrackedUser.externalId (no FK)"
        string agentId "no FK — survives soft-delete"
        datetime startedAt
        int sendCount
        datetime lastSentAt
        datetime windowCompletedAt "null = in exploration window"
        datetime releasedAt "null = actively owned"
        string releaseReason "conversion | cohort_exit | hold_cap_days | hold_cap_sends | manual"
    }

    FunnelTransition {
        string id PK
        string externalUserId
        string fromStage
        string toStage
        int recoveryRank "1=mau, 2=wau, 3=dau4"
        datetime detectedAt
        string attributedAgentId "null = organic"
        string attributedDecisionId
    }

    Agent ||--o{ UserDecision : "tracks"
    MessageVariant ||--o{ UserDecision : "selected in"
```

## Scheduling, metrics, ops, and settings

```mermaid
erDiagram
    SchedulingRule {
        string id PK
        string agentId FK "unique — one per agent"
        json frequencyCap "default {maxSends:3, period:week}"
        json quietHours "default {start:22:00, end:08:00, tz:America/New_York}"
        json blackoutDates "array of date strings"
        boolean smartSuppress
        float suppressThresh "default 0.5"
        boolean prioritizeLastSeen "default true"
    }

    ModelMetric {
        string id PK
        string agentId FK
        datetime timestamp
        json metrics "arbitrary metric snapshot"
    }

    CronRun {
        string id PK
        string cronName
        datetime startedAt
        datetime finishedAt
        string status "running | completed | failed"
        int sent
        int suppressed
        int errors
        int agentCount
        string errorMsg
    }

    FailedBrazeSend {
        string id PK
        string agentId
        string variantId
        string channel
        json userIds
        json decisionIds
        string reason
        datetime failedAt
        int retryCount
    }

    IngestSyncLog {
        string id PK
        string syncKind "user_sync | push_open_events | conversion_events | braze_events"
        datetime createdAt
        int received
        int upserted
        int matched
        int unmatched
        json details
    }

    ProcessedEventId {
        string eventId PK "Hightouch event_id for idempotency"
        datetime createdAt
    }

    UserSegment {
        string id PK
        string externalId "TrackedUser.externalId (no FK)"
        string segmentName
        datetime syncedAt
    }

    UserPreference {
        string id PK
        string workosUserId UK
        string hiddenStats "JSON array of hidden StatKey strings; default []"
    }

    AppSetting {
        string id PK
        string key UK
        string value
    }

    Agent ||--o| SchedulingRule : "has"
    Agent ||--o{ ModelMetric : "records"
```

## Auxiliary classification + content

```mermaid
erDiagram
    PlanSet {
        string id PK
        string setId UK "YouVersion Cassi set_id"
        string collectionId
        string name
        string slug
        string personaTag "maps to Persona.label"
        datetime syncedAt
    }

    PlanSetMember {
        string planId "YouVersion plan_id"
        string setId "PlanSet.setId"
    }

    CampaignContent {
        string id PK
        string campaign
        string contentType
        string language
        string usfmReference
        string usfmHuman
        string title
        string body
        string status "default active"
    }

    DemoUserGroup {
        string id PK
        string name UK
        json userIds "string[]"
    }

    SyncNameOverride {
        string syncId PK "Hightouch sync id"
        string displayName "admin-set, 1-100 chars"
        datetime updatedAt
        datetime createdAt
    }

    PlanSet ||--o{ PlanSetMember : "contains"
```

`PlanSet`/`PlanSetMember` back the rule-based persona classifier (mapping YouVersion plan_ids
to persona tags). `CampaignContent` stores per-language scripture content for campaigns.
`DemoUserGroup` holds named test-user ID sets for the Live Send Demo. `SyncNameOverride` is a
pure `syncId → displayName` lookup that lets admins rename a Hightouch sync for display on the
Data Ingest page; it is **display-only** and never participates in triggering (which keys purely
off the raw sync id).

## JSON Field Schemas

### `TrackedUser.channelStats`
```json
{
  "push":  { "sent": 12, "converted": 3 },
  "email": { "sent": 5,  "converted": 1 }
}
```

### `TrackedUser.featureVector` — 10 dimensions
```
[0] push conversion rate          [5] overall conversion rate
[1] email conversion rate         [6] recency score (1 − days_since_open/90)
[2] morning ratio (hrs 5–11)      [7] giving tier (0=none, 0.5=giver, 1=sower)
[3] evening ratio (hrs 17–22)     [8] spiritual depth (streak+plan+prayer+scripture+badge)
[4] weekend ratio (Sat+Sun)       [9] engagement freq (log-scaled decisions/week)
```
`FEATURE_DIM = 10` (`src/lib/engine/feature-vector.ts`). `Persona.centroid` and `LinUCBArm`
matrices are sized to this dimension. (The old "37-dim" layout in prior docs is obsolete.)

### `Agent.segmentTargeting`
```json
{ "includes": ["lapsed_mau", "gave_last_year"], "excludes": ["staff"] }
```
`null` falls back to `targetSegmentName`/`funnelStage`. Include semantics are OR within the
includes list; excludes remove members. See `docs/nexus-agent-targeting-spec.md`.

### `SchedulingRule.frequencyCap`
```json
{ "maxSends": 3, "period": "week" }
```

### `UserDecision.decisionContext`
```json
{ "giver_tier": "giver", "streak_status": "active", "streak_days": 14,
  "recency_days": 2, "trigger_event": "plan_completed" }
```

### `Persona.traits`
```json
{
  "engagementLevel": "daily",
  "dominantChannel": "push",
  "peakHour": 9,
  "giverProfile": "giver",
  "conversionRate": 0.18
}
```
