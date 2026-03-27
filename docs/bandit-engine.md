# Bandit Engine

How the multi-armed bandit algorithms select variants and learn from rewards.

## Algorithm Selection Flow

```mermaid
flowchart TD
    START([Select variant for user + agent]) --> ALGO{Agent.algorithm?}

    ALGO -->|thompson| TS_FLOW[Thompson Sampling]
    ALGO -->|epsilon_greedy| EG_FLOW[Epsilon-Greedy]
    ALGO -->|contextual| CTX[Contextual Bandit<br/>future / not yet implemented]

    subgraph TS["Thompson Sampling (thompson-sampling.ts)"]
        TS_FLOW --> TS1[Load PersonaArmStats<br/>for this persona + agent]
        TS1 --> TS2[For each variant arm:<br/>sample Beta α,β via Johnk method]
        TS2 --> TS3[Pick arm with<br/>highest sample value]
        TS3 --> TS4{Selected arm ==<br/>arm with most tries?}
        TS4 -->|no| TS5[Flag as explore=true]
        TS4 -->|yes| TS6[Flag as explore=false]
    end

    subgraph EG["Epsilon-Greedy (epsilon-greedy.ts)"]
        EG_FLOW --> EG1[Roll random 0-1]
        EG1 --> EG2{random < epsilon?}
        EG2 -->|yes| EG3[Explore: pick random arm]
        EG2 -->|no| EG4[Exploit: pick arm with<br/>highest wins/tries rate]
    end

    TS5 --> RESULT([Return variantId + explore flag])
    TS6 --> RESULT
    EG3 --> RESULT
    EG4 --> RESULT
```

## Reward Update Flow

```mermaid
flowchart TD
    EVENT([Conversion event arrives<br/>POST /api/ingest/events]) --> MATCH[Find UserDecision within<br/>48-hour window before event]
    MATCH --> GOAL[Match event.name to<br/>Agent Goal by eventName]
    GOAL --> TIER{Goal tier?}

    TIER -->|best| R1[baseReward = +10]
    TIER -->|very_good| R2[baseReward = +7]
    TIER -->|good| R3[baseReward = +5]
    TIER -->|bad| R4[baseReward = -2]
    TIER -->|very_bad| R5[baseReward = -5]
    TIER -->|worst| R6[baseReward = -10]

    R1 & R2 & R3 & R4 & R5 & R6 --> WEIGHT{Goal.weightMode?}

    WEIGHT -->|fixed| W1[weight = Goal.valueWeight]
    WEIGHT -->|property| W2[weight = event.properties<br/>Goal.weightProperty<br/>fallback: weightDefault]

    W1 & W2 --> NORM[reward = clamp baseReward × weight ÷ 100<br/>range: -1.0 to +1.0]

    NORM --> UPDATE_ARM[Update PersonaArmStats:<br/>reward > 0 → alpha += reward<br/>reward ≤ 0 → beta += 1]
    NORM --> UPDATE_DEC[Update UserDecision:<br/>conversionEvent, conversionAt, reward]
    NORM --> UPDATE_USER[Accumulate User stats:<br/>totalConversions++, totalReward += reward<br/>hourlyStats, dailyStats buckets]
```

## Beta Distribution Sampling (Johnk Method)

```mermaid
flowchart LR
    AB["α (successes), β (failures)"] --> SAMPLE["Sample x ~ Gamma(α,1)<br/>Sample y ~ Gamma(β,1)"]
    SAMPLE --> RATIO["Beta sample = x / (x + y)"]
    RATIO --> SELECT["Arm with highest sample wins"]
```

**Initial state:** α=1, β=1 (uninformed prior — equal probability for all arms)

**Interpretation:**
- High α, low β → arm is rewarded often → high sample → likely selected (exploit)
- Equal α=β → uncertain → high variance in samples → natural exploration

## PersonaArmStats Key

Each arm is uniquely keyed by `(personaId, agentId, variantId)`:

```
PersonaArmStats
├── personaId  → which user segment
├── agentId    → which optimization campaign
├── variantId  → which message variant (arm)
├── alpha      → cumulative positive reward weight
├── beta       → cumulative failure count
├── tries      → total selections
└── wins       → total conversions
```

This means: **each persona gets its own bandit model per agent**. A variant that works for
Persona A may not be selected for Persona B if its arm stats differ.

## Epsilon-Greedy Decay

```mermaid
flowchart LR
    E0["epsilon₀ = 0.1"] -->|each decay call| E1["epsilon × 0.995"]
    E1 --> E2["epsilon × 0.995 × 0.995 ..."]
    E2 --> FLOOR["floor at 0.01 — always 1% exploration"]
```
