# Bandit Engine

How the multi-armed bandit algorithms select variants and learn from rewards.

## Algorithm Selection Flow

```mermaid
flowchart TD
    START([Select variant for user + agent]) --> ALGO{Agent.algorithm?}

    ALGO -->|thompson| TS_FLOW[Thompson Sampling]
    ALGO -->|epsilon_greedy| EG_FLOW[Epsilon-Greedy]
    ALGO -->|linucb| LU_FLOW[LinUCB<br/>Contextual Bandit]

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

    subgraph LU["LinUCB (linucb.ts)"]
        LU_FLOW --> LU1[Load/init LinUCBArm rows<br/>aInv d×d + b d-float<br/>keyed by agentId+variantId]
        LU1 --> LU2[Compute user feature vector x<br/>10-dim behavioral + semantic]
        LU2 --> LU3[For each arm:<br/>θ = A⁻¹b<br/>score = θᵀx + α√xᵀA⁻¹x]
        LU3 --> LU4[Pick arm with highest UCB score]
    end

    TS5 --> RESULT([Return variantId + explore flag])
    TS6 --> RESULT
    EG3 --> RESULT
    EG4 --> RESULT
    LU4 --> RESULT
```

## Reward Update Flow

```mermaid
flowchart TD
    EVENT([Conversion event arrives<br/>/api/ingest/events or /api/ingest/braze-events]) --> MATCH[Find UserDecision within<br/>48-hour window before event]
    MATCH --> GOAL{Match event.name to<br/>Agent Goal by eventName}

    GOAL -->|gift_given| GIFT[Log-scale branch:<br/>frac = log10 1+usd ÷ log10 1+1000<br/>reward = baseReward÷10 × frac, clamp 0..1]
    GOAL -->|funnel_recovery, no Goal| REC[Recovery branch:<br/>rank 1/2/3 → good/very_good/best<br/>reward = base × 5 ÷ 100, clamp -1..1]
    GOAL -->|matched Goal| TIER{Goal tier?}

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

    GIFT & REC & NORM --> UPDATE_ARM[Apply temporal-decay update to both<br/>PersonaArmStats and UserArmStats<br/>see Arm Update + Temporal Decay below]
    UPDATE_ARM --> UPDATE_DEC[Update UserDecision:<br/>conversionEvent, conversionAt, reward, conversionValue]
    UPDATE_ARM --> UPDATE_USER[Accumulate TrackedUser stats:<br/>totalConversions++, totalReward += reward]
```

`calculateReward` lives in `src/lib/engine/reward-calculator.ts` (pure). Two special-cased
events bypass the tier×weight path: `gift_given` (amount-weighted on a log scale so larger
gifts read higher without saturating, capped at `$1000` → reward 1.0) and `funnel_recovery`
(a synthetic event emitted when a user climbs back out of a lapsed funnel stage — see
`docs/data-flows.md`). The recovery branch only fires when the agent has **no** explicit
`funnel_recovery` Goal; otherwise the normal tier×weight path applies.

## Beta Distribution Sampling (Johnk Method)

```mermaid
flowchart LR
    AB["α (successes), β (failures)"] --> SAMPLE["Sample x ~ Gamma(α,1)<br/>Sample y ~ Gamma(β,1)"]
    SAMPLE --> RATIO["Beta sample = x / (x + y)"]
    RATIO --> SELECT["Arm with highest sample wins"]
```

**Initial state:** α=1, β=30 — a pessimistic `Beta(1,30)` prior tuned to low baseline push
conversion rates, which damps noisy over-exploration during warm-up. Cold-start arms with no
`PersonaArmStats` row yet are seeded with these same values at selection time.

**Interpretation:**
- High α, low β → arm is rewarded often → high sample → likely selected (exploit)
- Low α, high β (warm-up state) → low samples, but uncertainty still lets arms win occasionally → natural exploration

## PersonaArmStats Key

Each arm is uniquely keyed by `(personaId, agentId, variantId)`:

```
PersonaArmStats
├── personaId  → which user segment
├── agentId    → which optimization campaign
├── variantId  → which message variant (arm)
├── alpha      → cumulative positive reward mass
├── beta       → cumulative non-positive evidence
├── tries      → total selections
└── wins       → total positive-reward outcomes
```

This means: **each persona gets its own bandit model per agent**. A variant that works for
Persona A may not be selected for Persona B if its arm stats differ.

## Per-User Blending (blendArm)

At selection time the persona-level prior is blended with that user's own posterior
(`UserArmStats`, keyed by `(userId, agentId, variantId)`) via `blendArm` in
`src/lib/engine/select-variant.ts`:

```
alpha = personaArm.alpha + userStats.wins
beta  = personaArm.beta  + (userStats.tries − userStats.wins)
```

A user with personal history pulls the estimate toward their own behavior; a user with no
history (zero tries) gets the persona prior unchanged. LinUCB does not blend — its context
vector already carries the per-user profile.

## Arm Update + Temporal Decay

Arm updates happen in the IO layer (`src/lib/arm-stats.ts`), not in the pure engine, because
they run as atomic `$queryRaw` upserts. Every update applies a ~0.99 multiplicative decay to
the accumulated mass above the prior so stale evidence fades and the bandit keeps adapting:

```
alpha_new = GREATEST(1,  1 + (alpha − 1) × 0.99 + Δalpha)
beta_new  = GREATEST(1,  1 + (beta  − 1) × 0.99 + Δbeta)
```

where a positive reward contributes `Δalpha = reward`, and a non-positive reward contributes
`Δbeta = 1`. The same decay is applied to both `PersonaArmStats` and `UserArmStats`.

## Epsilon-Greedy

`EpsilonGreedy` (`src/lib/engine/epsilon-greedy.ts`) takes a fixed `epsilon` (default `0.1`)
and does **not** decay it: each call rolls `random() < epsilon` to explore (uniform random
arm) vs. exploit (highest `wins/tries` rate). Decay, if desired, would be applied by the
caller — the engine itself keeps epsilon constant.

## LinUCB — Contextual Bandit

Uses the user's 10-dim feature vector as context to personalise variant selection.

```mermaid
flowchart LR
    X["Context x (10-dim)"] --> THETA["θ = A⁻¹b"]
    THETA --> EXPLOIT["exploit = θᵀx"]
    X --> UNCERTAIN["uncertainty = α√(xᵀA⁻¹x)"]
    EXPLOIT --> SCORE["UCB score = exploit + uncertainty"]
    UNCERTAIN --> SCORE
    SCORE --> SELECT["Select arm with highest score"]
```

**Arm state (LinUCBArm table):**
- `aInv` — flattened d×d inverse design matrix (100 floats for d=10); initialised to identity I
- `b` — d-float accumulated reward vector; initialised to zero
- `tries` — total selections

**Update rule (Sherman-Morrison rank-1 inverse update):**
```
A⁻¹_new = A⁻¹ − (A⁻¹x)(A⁻¹x)ᵀ / (1 + xᵀA⁻¹x)
b_new   = b + reward · x
```

Unlike Thompson Sampling and Epsilon-Greedy, LinUCB arms are **not** segmented by persona — the context vector x already carries the user's behavioral profile, so a single model per (agentId, variantId) pair is sufficient.

**Reference:** Chu et al. (2011) "Contextual Bandits with Linear Payoff Functions"
