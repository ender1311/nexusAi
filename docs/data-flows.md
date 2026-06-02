# Data Flows

End-to-end flows for the main system operations.

## Flow 1: User Profile Ingestion

Hightouch syncs user profiles from the data warehouse into Nexus using the nested
`{ users: [...] }` format, which stores the full `attributes` object verbatim.

```mermaid
sequenceDiagram
    participant DW as Data Warehouse
    participant HT as Hightouch
    participant API as POST /api/ingest/users
    participant DB as PostgreSQL

    DW->>HT: User profile records
    HT->>API: POST { users: [{ external_user_id, braze_id?, attributes }] }
    Note over API: verifyIngestAuth (Bearer key<br/>or x-hightouch-token)
    API->>DB: Batch findMany existing by externalId
    API->>DB: UPSERT TrackedUser on externalId
    Note over API,DB: Stores attributes JSON verbatim<br/>Does NOT reset bandit stats<br/>Identity-resolves unverified brazeId-keyed rows<br/>Detects funnel recovery on stage advance
    API-->>HT: { ok, received, deduplicated,<br/>skipped_anonymous, upserted, persona_assigned }
```

## Flow 2: Conversion Event Ingestion → Reward Loop

The critical learning loop: events arrive and update the bandit's arm stats. The
**primary** reward path is `/api/ingest/braze-events` (Braze Currents click →
reward); `/api/ingest/events` is the generic Hightouch event path shown here.
Both are idempotent on `event_id` via the `ProcessedEventId` table.

```mermaid
sequenceDiagram
    participant APP as Mobile / Web App
    participant HT as Hightouch
    participant API as POST /api/ingest/events
    participant RC as RewardCalculator
    participant US as UserStats
    participant ARM as PersonaArmStats
    participant DB as PostgreSQL

    APP->>HT: Conversion event (e.g. plan_started, gift_given)
    HT->>API: POST { events: [{ event_id, event_name,<br/>external_user_id, occurred_at, properties }] }
    Note over API: verifyIngestAuth · dedupe on event_id

    API->>DB: Batch lookup TrackedUser by externalId
    API->>DB: Find UserDecision within 48h window before event
    Note over API,DB: Matches on userId, no brazeSendId required

    alt Decision found
        API->>RC: calculateReward(event, agent.goals)
        Note over RC: Tier base reward · property weights ·<br/>gift_given log-scale · funnel_recovery rank
        RC-->>API: scalar reward

        API->>DB: Update UserDecision<br/>{ conversionEvent, conversionAt, reward, conversionValue }
        API->>US: accumulateUserStats(userId, event)
        US->>DB: totalConversions++, totalReward += reward<br/>hourlyStats[hour]++, dailyStats[day]++

        API->>ARM: updateArm (PersonaArmStats + UserArmStats)
        ARM->>DB: temporal decay ~0.99 then apply Δ<br/>alpha = GREATEST(1, 1 + (alpha−1)×0.99 + Δalpha)<br/>tries++, wins++ (if reward > 0)
    else No matching decision
        API-->>HT: event recorded as unmatched
    end

    API-->>HT: { ok, received, deduplicated, matched, unmatched }
```

## Flow 3: Variant Selection (Bandit Decision)

How a variant is chosen for a user. Selection is exposed as a real route —
`POST /api/decide` (ingest-auth, `src/lib/decide.ts`) and
`POST /api/agents/:id/decide` (cron) — and is also invoked inline by the
`select-and-send` cron. All paths share the `selectVariant` dispatch in
`src/lib/engine/select-variant.ts`.

```mermaid
sequenceDiagram
    participant CALLER as /api/decide · cron · agent decide
    participant SV as selectVariant dispatch
    participant ALGO as Bandit Algorithm
    participant DB as PostgreSQL
    participant BRAZE as Braze

    CALLER->>DB: Lookup TrackedUser → personaId + featureVector
    CALLER->>DB: Get Agent.algorithm + epsilon
    CALLER->>SV: selectVariant(agent, user, variants)

    alt algorithm = thompson
        SV->>DB: Load PersonaArmStats prior + UserArmStats posterior
        SV->>SV: blendArm(personaArm, userStats)
        SV->>ALGO: thompsonSelect(blended, recencyPenalties)
        ALGO-->>SV: variantId (Beta sample × recencyMultiplier)
    else algorithm = epsilon_greedy
        SV->>DB: Load + blendArm
        SV->>ALGO: epsilonGreedySelect(blended, epsilon=0.1)
        ALGO-->>SV: variantId (explore ε / exploit)
    else algorithm = linucb
        SV->>DB: Load LinUCBArm (aInv, b) per variant
        SV->>ALGO: linUCB.select(arms, featureVec)
        ALGO-->>SV: variantId (UCB score maximiser)
    end

    SV-->>CALLER: variantId
    CALLER->>DB: INSERT UserDecision<br/>{ agentId, userId, variantId, channel, scheduledFor }
    CALLER->>BRAZE: Schedule send via BrazeClient
    BRAZE-->>CALLER: brazeScheduleId
    CALLER->>DB: UPDATE UserDecision { brazeSendId, brazeScheduleId }
```

## Flow 4: Persona Discovery & Assignment

Periodic clustering of users into personas.

```mermaid
sequenceDiagram
    participant ADMIN as Admin UI /personas
    participant API as POST /api/personas/discover
    participant FV as FeatureVector
    participant PD as PersonaDiscovery
    participant PA as PersonaAssignment
    participant DB as PostgreSQL

    ADMIN->>API: POST /api/personas/discover<br/>{ minK, maxK, minInteractions }

    API->>DB: Load TrackedUser with totalDecisions >= minInteractions (20)
    loop for each user
        API->>FV: computeFeatureVector(user)
        Note over FV: 10 dims: push/email rates [0-1]<br/>morning/evening/weekend ratios [2-4]<br/>conv rate, recency [5-6]<br/>giving tier, spiritual depth, freq [7-9]
        FV-->>API: float[10]
    end
    API->>PD: Fisher-Yates downsample to maxSampleSize (3000) if larger

    API->>PD: discoverPersonas(users, featureVectors, config)
    alt algorithm = hdbscan (default)
        PD->>PD: HDBSCAN minPts=5, minClusterSize=30<br/>finds k automatically · noise → −1
    else algorithm = kmeans (fallback)
        loop k = minK..maxK
            PD->>PD: runKMeans × stabilityRuns, cosine distance
            PD->>PD: Compute silhouette score
        end
        PD->>PD: Keep k with best silhouette
    end
    PD->>PD: Silhouette gate: abort if k>1 and silhouette < 0.25
    PD->>PD: deriveTrait per cluster<br/>(dominant channel, peak hour,<br/>engagement level, giver profile, depth)

    PD->>DB: Upsert Persona { source:"discovered", centroid,<br/>clusterSize, silhouetteScore, traits, discoveredAt }<br/>deactivate stale discovered personas
    PD-->>API: personas[]

    API->>PA: batchAssignPersonas(users, personas)
    loop for each user
        PA->>PA: cosineSimilarity(userVector, persona.centroid)
        PA->>PA: effectiveConf = similarity × min(1, decisions/20)
        PA->>DB: if effectiveConf ≥ threshold → UPDATE TrackedUser<br/>{ personaId, personaConfidence, personaAssignedAt }
    end

    API-->>ADMIN: { ok, personasCreated, personasUpdated,<br/>usersAssigned, silhouetteScore, k }
```

## Flow 5: Settings & Braze Configuration

```mermaid
sequenceDiagram
    participant UI as Settings Page /settings
    participant API as /api/settings
    participant DB as AppSetting table

    UI->>API: POST { BRAZE_API_KEY, BRAZE_REST_ENDPOINT, ... }
    Note over UI,API: requireAdmin (WorkOS session)
    API->>DB: UPSERT AppSetting per key
    Note over API,DB: Keys: BRAZE_API_KEY, BRAZE_REST_ENDPOINT,<br/>BRAZE_NEXUS_CAMPAIGN_ID,<br/>BRAZE_NEXUS_IOS_VARIANT_ID, ...

    UI->>API: GET /api/settings
    API->>DB: SELECT all AppSettings
    API-->>UI: { data: { BRAZE_API_KEY, BRAZE_REST_ENDPOINT, ... } }

    Note over API,DB: createBrazeClient() reads BRAZE_API_KEY +<br/>BRAZE_REST_ENDPOINT from process.env; returns null<br/>when unset, so Braze calls degrade gracefully.<br/>AppSetting persists UI edits but needs an env sync.
```

## Flow 6: Hourly Send Pipeline

The `select-and-send` cron (`0 * * * *`) is the system's heartbeat: it assigns
users to agents, picks variants, schedules sends, and persists ownership. The
full phase-by-phase breakdown lives in `docs/send-timing-architecture.md`; the
sequence below is the condensed view.

```mermaid
sequenceDiagram
    participant CRON as Vercel Cron (0 * * * *)
    participant API as /api/cron/select-and-send
    participant SV as selectVariant
    participant BRAZE as Braze
    participant DB as PostgreSQL

    CRON->>API: GET/POST (Bearer $CRON_SECRET)
    API->>DB: Phase −1 release sweep (holdMaxDays / holdMaxSends)
    API->>DB: Build fleet exclusivity map (one owner per user)
    API->>DB: Pre-assign: targeting + staleness + language + consent
    API->>DB: Lottery map (audienceCap / uniqueUsersCap) + Phase 0 windows

    loop per agent → per candidate
        API->>API: caps · quiet hours · smart-suppress gate
        API->>SV: selectVariant(agent, user, variants)
        SV-->>API: variantId
        API->>API: computeScheduledAt → { scheduledAt, inLocalTime }
    end

    API->>BRAZE: Group by (variantId × scheduledAt × inLocalTime)<br/>schedule ~50 concurrent
    BRAZE-->>API: brazeScheduleId per group
    API->>DB: Record UserDecision rows (scheduledFor, decisionContext.inLocalTime)
    API->>DB: Persist UserAgentAssignment (sendCount++, lastSentAt, lock)
    API->>DB: Write CronRun (sent / suppressed / errors / agentCount)
```
