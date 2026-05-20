# Bandit Engine — Local Conventions

## Purity contract

Every function in this directory must remain **pure**: no DB calls, no API calls, no side effects, no global state. This makes them unit-testable in isolation without a running database.

- `reward-calculator.ts` — maps conversion events to scalar rewards using goal tiers/weights
- `thompson-sampling.ts` / `epsilon-greedy.ts` — arm selection; only inputs are arm stats + config
- `persona-discovery.ts` — k-means clustering on feature vectors; pure transform
- `persona-assignment.ts` — assigns users to nearest centroid; pure transform
- `linucb.ts` — LinUCB contextual bandit (arm storage + UCB selection + Sherman-Morrison update)

Side effects (DB writes, API calls, cron triggers) belong in `src/app/api/` route handlers, not here.

## Statistical code

When touching sampling / reward / clustering logic, add a one-line comment with the formula or reference (e.g., `// Beta(α+1, β) after positive reward — standard Thompson update`). Reviewers should be able to verify correctness without re-deriving the math.

## Testing

Unit tests live in `tests/unit/engine/`. Add a test for every new engine function — they're pure so there's no test DB dependency.
