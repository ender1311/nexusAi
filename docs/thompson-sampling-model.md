# Thompson Sampling Model

How Nexus uses Thompson Sampling to choose message variants and learn from conversion outcomes.

## What this model does

For each `(personaId, agentId)` pair, every active message variant is treated as a bandit arm.
At decision time, the model:

1. Loads that arm's stats (`alpha`, `beta`, `tries`, `wins`) from `PersonaArmStats`
2. Draws one sample from `Beta(alpha, beta)` per arm
3. Selects the arm with the highest sampled value

This gives a built-in exploration/exploitation balance:
- Arms with strong history tend to sample high (exploit)
- Arms with high uncertainty still occasionally win samples (explore)

## Where it is implemented

- Core model: `src/lib/engine/thompson-sampling.ts`
- Decision integration: `src/lib/decide.ts`
- Unit tests: `tests/unit/thompson-sampling.test.ts`
- Shared bandit flow context: `docs/bandit-engine.md`

## Arm state and priors

Each arm stores:
- `alpha`: accumulated positive reward mass
- `beta`: accumulated non-positive outcomes count
- `tries`: total selections
- `wins`: count of positive-reward outcomes

### Initial prior

Nexus initializes new arms with:

```ts
alpha = 1
beta = 30
tries = 0
wins = 0
```

This is a pessimistic prior (`Beta(1,30)`) tuned to low baseline push conversion rates, which reduces noisy over-exploration during warm-up.

## Selection algorithm

### 1) Beta sampling via Gamma ratio

The model samples `Beta(alpha, beta)` as:

- `x ~ Gamma(alpha, 1)`
- `y ~ Gamma(beta, 1)`
- `sample = x / (x + y)`

Gamma sampling uses a Marsaglia-Tsang method with a Box-Muller normal sampler in `thompson-sampling.ts`.

### 2) Pick best sample

After sampling all arms once, the selected variant is the arm with the largest sample value.
`select(arms, recencyPenalties?)` accepts an optional per-arm multiplier map: the cron route
passes `recencyMultiplier(daysSinceSent)` (from `@/lib/engine/beta-pdf`, clamped to
`[0.2, 1.0]`) so a variant just sent to this user is temporarily down-weighted to encourage
rotation. The multiplier is applied to the Beta sample before the max is taken.

### 3) Exploration flag

`DecisionResult.explore` is set by comparing the selected arm to the arm with maximum `tries`:
- `true` if selected arm is not the most-tried arm
- `false` otherwise

## Update rule after reward

Arm updates are **not** done in the pure engine. They run as atomic decay-aware upserts in
`src/lib/arm-stats.ts` against both `PersonaArmStats` and `UserArmStats`:

```
alpha_new = GREATEST(1, 1 + (alpha − 1) × 0.99 + Δalpha)   # Δalpha = reward when reward > 0
beta_new  = GREATEST(1, 1 + (beta  − 1) × 0.99 + Δbeta)     # Δbeta  = 1 when reward ≤ 0
```

This means:
- Positive outcomes increase posterior success mass; zero/negative outcomes increase failure evidence
- The ~0.99 multiplicative decay on the mass above the prior lets stale evidence fade so the model keeps adapting

## Runtime flow in Nexus

The two callers are `/api/decide` (`src/lib/decide.ts`) and the cron route
(`src/app/api/cron/select-and-send/route.ts`). Both:

1. Load active variants for the target agent
2. Read/seed `PersonaArmStats` rows per variant for the resolved persona (cold-start seed `Beta(1,30)`)
3. Blend in the user's `UserArmStats` posterior via `blendArm` (see `docs/bandit-engine.md`)
4. If `agent.algorithm === "thompson"`, call `selectVariant({ algorithm: "thompson", arms, recencyPenalties })` (dispatches to `new ThompsonSampling().select(...)`)
5. Persist the chosen variant to `UserDecision`
6. Later conversion events apply the decay-aware reward update above

## Tests and behavioral guarantees

`tests/unit/thompson-sampling.test.ts` covers:
- Empty-arm guardrail (`No arms to select from`)
- Single-arm deterministic selection
- Statistical preference for strong arms over repeated draws
- Correct positive/zero/negative reward updates
- Correct `explore` labeling when a non-greedy arm is selected

## Notes

- The repository also supports `epsilon_greedy` and `linucb`; this doc is only for the Thompson path.
- For end-to-end reward and ingestion flow, see `docs/bandit-engine.md` and `docs/data-flows.md`.
