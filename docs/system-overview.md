# System Overview

Nexus is a multi-armed bandit optimization platform for personalizing messaging (push/email/SMS)
across user personas. It integrates with Braze as the message delivery layer and Hightouch for
event/user data ingestion.

```mermaid
graph TB
    subgraph External["External Systems"]
        BRAZE[Braze CDM<br/>Push / Email / SMS delivery]
        HT[Hightouch<br/>Reverse ETL / CDP]
        WAREHOUSE[Data Warehouse<br/>User profiles & events]
    end

    subgraph Nexus["Nexus Platform"]
        subgraph UI["Next.js App Router (port 3000)"]
            DASH[Dashboard /]
            AGENTS[Agent Manager /agents]
            PERSONAS[Persona Manager /personas]
            PERF[Performance /performance]
            SETTINGS[Settings /settings]
            TOWER[Control Tower /control-tower]
        end

        subgraph API["API Routes /api"]
            API_AGENTS[/api/agents CRUD]
            API_PERSONAS[/api/personas CRUD + discover]
            API_INGEST_E[/api/ingest/events]
            API_INGEST_U[/api/ingest/users]
            API_SETTINGS[/api/settings]
            API_DECIDE[/api/decide]
            API_CRON[/api/cron/select-and-send]
        end

        subgraph ENGINE["Bandit Engine (src/lib/engine)"]
            TS[Thompson Sampling]
            EG[Epsilon-Greedy]
            RC[Reward Calculator]
            PD[Persona Discovery<br/>K-Means Clustering]
            PA[Persona Assignment<br/>Cosine Similarity]
            FV[Feature Vector<br/>37 dimensions]
            US[User Stats<br/>Accumulator]
        end

        subgraph BRAZE_LIB["Braze Integration (src/lib/braze)"]
            BC[BrazeClient<br/>REST wrapper]
            PF[PayloadFactory<br/>Channel payloads]
            BA[BrazeAnalytics<br/>Campaign metrics]
        end

        DB[(PostgreSQL + Neon<br/>Prisma v7)]
    end

    WAREHOUSE -->|sync user profiles| HT
    HT -->|POST /api/ingest/users| API_INGEST_U
    HT -->|POST /api/ingest/events| API_INGEST_E

    API_INGEST_E --> RC
    API_INGEST_E --> US
    API_INGEST_E --> TS
    API_INGEST_U --> DB

    API_AGENTS --> DB
    API_PERSONAS --> PD
    API_PERSONAS --> PA
    PD --> DB
    PA --> DB

    TS --> DB
    EG --> DB
    US --> FV
    FV --> PD
    FV --> PA

    BC --> BRAZE
    PF --> BC
    BA --> BRAZE

    UI --> API
    API --> ENGINE
    API --> BRAZE_LIB
    ENGINE --> DB
    BRAZE_LIB --> BRAZE
```

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Agent** | An optimization campaign. Has goals, messages, a bandit algorithm, and target personas |
| **Message / Variant** | A message (channel + name) with A/B variants the bandit chooses between |
| **Goal** | A conversion event (e.g. `plan_started`) mapped to a reward tier |
| **Persona** | A user segment discovered by k-means clustering on 37-dim feature vectors |
| **PersonaArmStats** | Per-persona Beta distribution params (α/β) for each agent×variant arm |
| **UserDecision** | A record of each message send + optional conversion link |
| **Feature Vector** | 37-float representation of a user: channel affinity, timing, frequency, reward |
