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

### 3) Exploration flag

`DecisionResult.explore` is set by comparing the selected arm to the arm with maximum `tries`:
- `true` if selected arm is not the most-tried arm
- `false` otherwise

## Update rule after reward

When a reward is applied to an arm (`updateArm(stats, reward)`):

- `alpha += reward` when `reward > 0`
- `beta += 1` when `reward <= 0`
- `tries += 1` always
- `wins += 1` when `reward > 0`

This means:
- Positive outcomes increase posterior success mass
- Zero/negative outcomes increase posterior failure evidence

## Runtime flow in Nexus

In `decideForUser`:

1. Active variants are loaded for the target agent
2. `PersonaArmStats` rows are read/seeded per variant for the resolved persona
3. If `agent.algorithm === "thompson"` (default bandit path), `new ThompsonSampling().select(armStats)` is used
4. The chosen variant is persisted to `UserDecision`
5. Later conversion events update reward and arm stats

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
