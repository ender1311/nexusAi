# Data Flows

End-to-end flows for the four main system operations.

## Flow 1: User Profile Ingestion

Hightouch syncs user profiles from the data warehouse into Nexus.

```mermaid
sequenceDiagram
    participant DW as Data Warehouse
    participant HT as Hightouch
    participant API as POST /api/ingest/users
    participant DB as PostgreSQL

    DW->>HT: User profile records
    HT->>API: POST { users: [{externalId, attributes}] }
    API->>DB: UPSERT User on externalId
    Note over API,DB: Sets attributes JSON<br/>Does NOT reset stats
    API-->>HT: { updated: N }
```

## Flow 2: Conversion Event Ingestion → Reward Loop

The critical learning loop: events arrive and update the bandit's arm stats.

```mermaid
sequenceDiagram
    participant APP as Mobile / Web App
    participant HT as Hightouch
    participant API as POST /api/ingest/events
    participant RC as RewardCalculator
    participant US as UserStats
    participant ARM as PersonaArmStats
    participant DB as PostgreSQL

    APP->>HT: Conversion event (e.g. plan_started)
    HT->>API: POST { events: [{externalId, name, timestamp, properties}] }

    API->>DB: Lookup User by externalId
    API->>DB: Find UserDecision within 48h window before event
    Note over API,DB: Matches on userId, no brazeSendId required

    alt Decision found
        API->>RC: calculateReward(event, agent.goals)
        RC-->>API: reward (-1.0 to +1.0)

        API->>DB: Update UserDecision<br/>{ conversionEvent, conversionAt, reward }
        API->>US: accumulateUserStats(userId, event)
        US->>DB: totalConversions++, totalReward += reward<br/>hourlyStats[hour]++, dailyStats[day]++

        API->>ARM: updateArm(personaId, agentId, variantId, reward)
        ARM->>DB: reward > 0 → alpha += reward<br/>reward ≤ 0 → beta += 1<br/>tries++, wins++ (if reward > 0)
    else No matching decision
        API-->>HT: event skipped (no attribution window match)
    end

    API-->>HT: { processed: N, matched: M }
```

## Flow 3: Variant Selection (Bandit Decision)

How a variant is chosen for a user at send time.
> Note: The selection endpoint is not yet a standalone API route — the logic lives in
> `src/lib/engine/` and is invoked inline or via Braze-triggered flows.

```mermaid
sequenceDiagram
    participant CALLER as Send Trigger
    participant ALGO as Bandit Algorithm
    participant DB as PostgreSQL
    participant BRAZE as Braze

    CALLER->>DB: Lookup User → personaId
    CALLER->>DB: Get Agent.algorithm + epsilon
    CALLER->>DB: Load PersonaArmStats<br/>for (personaId, agentId, all variantIds)

    alt algorithm = thompson
        CALLER->>ALGO: thompsonSelect(arms)
        ALGO-->>CALLER: variantId (sampled from Beta)
    else algorithm = epsilon_greedy
        CALLER->>ALGO: epsilonGreedySelect(arms, epsilon)
        ALGO-->>CALLER: variantId (explore or exploit)
    else algorithm = linucb
        CALLER->>ALGO: linUCB.select(arms, featureVec)
        ALGO-->>CALLER: variantId (UCB score maximiser)
    end

    CALLER->>DB: INSERT UserDecision<br/>{ agentId, userId, variantId, channel, sentAt }
    CALLER->>BRAZE: Send message via BrazeClient<br/>using selected variant's content
    BRAZE-->>CALLER: brazeSendId
    CALLER->>DB: UPDATE UserDecision.brazeSendId
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

    API->>DB: Load users with totalDecisions >= 20
    loop for each user
        API->>FV: computeFeatureVector(user)
        Note over FV: 10 dims: push/email rates [0-1]<br/>morning/evening/weekend ratios [2-4]<br/>conv rate, recency [5-6]<br/>giving tier, spiritual depth, freq [7-9]
        FV-->>API: float[10]
    end

    API->>PD: discoverPersonas(users, featureVectors, config)
    loop k = minK..maxK
        PD->>PD: K-Means++ init<br/>100 iterations, cosine distance
        PD->>PD: Compute silhouette score
    end
    PD->>PD: Keep k with best silhouette score
    PD->>PD: Derive traits per cluster<br/>(dominant channel, peak hour,<br/>engagement level, conversion rate)

    PD->>DB: Upsert Persona records<br/>{ centroid, clusterSize, silhouetteScore, traits }
    PD-->>API: personas[]

    API->>PA: batchAssignPersonas(users, personas)
    loop for each user
        PA->>PA: cosineSimilarity(userVector, persona.centroid)<br/>× dataRichnessFactor
        PA->>PA: Find nearest persona above threshold
        PA->>DB: UPDATE User<br/>{ personaId, personaConfidence, personaAssignedAt }
    end

    API-->>ADMIN: { personas: N, usersAssigned: M }
```

## Flow 5: Settings & Braze Configuration

```mermaid
sequenceDiagram
    participant UI as Settings Page /settings
    participant API as /api/settings
    participant DB as AppSetting table
    participant ENV as process.env

    UI->>API: POST { BRAZE_API_KEY, BRAZE_REST_URL, ... }
    API->>DB: UPSERT AppSetting per key
    Note over API,DB: Keys: BRAZE_API_KEY, BRAZE_REST_URL,<br/>BRAZE_ANDROID_APP_ID, BRAZE_IOS_APP_ID,<br/>BRAZE_WEB_APP_ID, BRAZE_APP_GROUP_ID

    UI->>API: GET /api/settings
    API->>DB: SELECT all AppSettings
    API-->>UI: { BRAZE_API_KEY: "...", ... }

    Note over ENV: BrazeClient reads from process.env at runtime.<br/>Settings UI saves to DB; a restart or env sync<br/>is needed for changes to take effect in BrazeClient.
```
