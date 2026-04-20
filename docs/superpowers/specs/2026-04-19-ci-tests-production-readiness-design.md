# Nexus: CI/CD, Test Suite & Production Readiness Design

**Date:** 2026-04-19
**Status:** Approved
**Scope:** Engineering infrastructure (test framework, CI pipeline, git hooks) + test suite (unit, contract, integration, regression) + production readiness execution (Steps 1–7 from `docs/production-readiness.md`)

---

## 1. Context

Nexus is a multi-armed bandit optimization platform. The engine and data model are fully implemented. Three critical production gaps remain:

1. **`/api/decide` is missing** — no variant selection happens today
2. **PersonaArmStats never updates** — the bandit never learns from conversions (20-line bug in `/api/ingest/events`)
3. **`/api/cron/select-and-send` is missing** — messages are never sent to users

Before fixing these, we establish a test suite and CI pipeline so every fix ships with coverage and merges are gated on passing checks.

---

## 2. Engineering Infrastructure

### 2.1 Test Framework

- **Runner:** Bun native test runner (`bun test`) — same as sibling repo `beacon`
- **DOM:** Happy DOM (via `@happy-dom/global-registrator`) — lighter than jsdom, sufficient for component tests
- **Mocking:** Bun's `vi`-compatible API (`mock`, `spyOn`, `vi.hoisted`)
- **Assertions:** `expect` extended with `@testing-library/jest-dom` matchers

**`bunfig.toml`** (project root):
```toml
[test]
root = "tests"
preload = ["./tests/setup/happy-dom.ts", "./tests/setup/bun.ts"]
```

**`tests/setup/happy-dom.ts`** — registers Happy DOM globally before each test file.

**`tests/setup/bun.ts`** — extends `expect` with jest-dom matchers; polyfills `vi` for Bun compat; stubs Next.js preload modules (`next/navigation`, `next/cache`, `next/font/google`); runs cleanup after each test.

### 2.2 Test Directory Structure

```
tests/
  unit/               # Pure functions — no DB, no I/O, <1ms each
  contracts/          # External service boundary contracts (BrazeClient)
  integration/        # API routes against a real Neon test-branch DB
  regression/         # Named tests preventing specific fixed bugs from re-occurring
  helpers/
    db.ts             # DB seed/truncate utilities (prisma test client)
    braze.ts          # FakeBrazeTransport — queues responses, records requests
    request.ts        # buildRequest() helper for route handlers
    builders.ts       # Test data factories (buildAgent, buildPersona, buildUser, etc.)
  setup/
    happy-dom.ts
    bun.ts
```

### 2.3 package.json Scripts

```json
{
  "test":        "bun test --bail=1 tests/unit & bun test --bail=1 tests/contracts & wait && bun test --max-concurrency=1 --bail=1 tests/integration && bun test --max-concurrency=1 --bail=1 tests/regression",
  "test:quick":  "bun test --bail=1 tests/unit tests/contracts",
  "test:watch":  "bun test --watch tests/unit",
  "check":       "bun run typecheck && bun run lint && bun run test",
  "check:quick": "bun run typecheck && bun run lint && bun run test:quick"
}
```

- `unit` + `contracts` run in parallel (no DB, safe to parallelize)
- `integration` + `regression` run serially after (`--max-concurrency=1`) to prevent DB state pollution
- `check:quick` is the pre-push hook target — completes in <30s

### 2.4 GitLab CI Pipeline

File: `.gitlab-ci.yml`

**Stages:** `prepare` → `verify` (parallel) → `build` (main only)

```yaml
prepare:install:
  stage: prepare
  image: oven/bun:1.x-alpine
  script: bun install --frozen-lockfile
  cache: { policy: push, key: bun-$CI_COMMIT_REF_SLUG, paths: [.bun/install/cache] }

verify:typecheck:
  stage: verify
  script: bun run typecheck
  cache: { policy: pull }

verify:lint:
  stage: verify
  script: bun run lint
  cache: { policy: pull }

verify:test:
  stage: verify
  timeout: 15 minutes
  variables:
    DATABASE_URL: $TEST_DATABASE_URL   # Neon test-branch URL from GitLab CI/CD Variables
  script: bun run test
  cache: { policy: pull }

build:
  stage: build
  only: [main]
  variables:
    NODE_OPTIONS: --max-old-space-size=1536
  script: bun run build
  cache: { policy: pull }
```

**CI/CD Variables (set in GitLab project settings):**
- `TEST_DATABASE_URL` — Neon `nexus-test` branch connection string
- `INGEST_API_KEY` — test value for auth assertions
- `CRON_SECRET` — test value

### 2.5 Pre-push Hook (Husky)

- Installed via `husky` devDependency
- `pre-push` hook runs `bun run check:quick` — catches type errors and fast tests before the push reaches GitLab
- No pre-commit hook (editor lint-on-save handles formatting)

### 2.6 Neon Test Branch

- Branch name: `nexus-test`
- Integration tests call `prisma migrate deploy` at test suite start (CI only, guarded by `TEST_DATABASE_URL` presence)
- `tests/helpers/db.ts` exports `truncateAll()` — called in `beforeEach` for integration test files to isolate state

---

## 3. Test Strategy

### 3.1 Unit Tests (`tests/unit/`)

Target: all pure engine functions. No DB calls permitted. Each test file maps 1:1 to an engine module.

| File | Key cases |
|------|-----------|
| `thompson-sampling.test.ts` | `initialStats()` returns α=1,β=1,tries=0,wins=0; `select()` over 1000 draws favors high-α arm >80%; `updateArm()` increments α on positive reward, β on non-positive |
| `epsilon-greedy.test.ts` | Same arm update logic; `decayEpsilon()` floors at `minEpsilon`; exploration probability ≈ ε |
| `reward-calculator.test.ts` | All 6 tier values map correctly; fixed vs property weight modes; `calculateCumulativeReward` sums correctly; unknown event → 0; negative tiers produce negative reward |
| `feature-vector.test.ts` | Output is 37-element array; channel affinity sums to ≤1; `cosineSimilarity` returns 1.0 for identical vectors, 0 for orthogonal, 0 for zero-length mismatch |
| `variant-diff.test.ts` | Detects all 7 diffable fields; identical variants → empty array; single variant → empty array |
| `frequency-resolver.test.ts` | Variant-level override wins; falls back to agent-level rule; returns null when neither set |

### 3.2 Contract Tests (`tests/contracts/`)

**`braze-client.test.ts`**
- Uses `FakeBrazeTransport` (in `tests/helpers/braze.ts`): implements `fetch` interface, queues mock responses, records all requests made
- Tests: URL normalization (adds `https://`, strips trailing slash); `Authorization: Bearer` header present; `createSendId()` handles Braze API error gracefully (returns null); `post()` sends correct Content-Type
- Tests `PayloadFactory.buildPushPayload()` / `buildEmailPayload()` / `buildSmsPayload()` output shape (no HTTP required — pure functions)

### 3.3 Integration Tests (`tests/integration/`)

Each file truncates all tables in `beforeEach`. Tests hit real Prisma → real Neon test DB.

**`agents.test.ts`** — CRUD, goal/message cascade on delete

**`ingest-users.test.ts`**
- Upserts user attributes
- Batch deduplication by `external_user_id`
- Returns 401 without valid `INGEST_API_KEY`
- Returns 400 on missing `external_user_id`

**`ingest-events.test.ts`**
- Matches event to `UserDecision` within 48h window
- Does NOT match events outside 48h window
- Calculates correct reward from goal tier
- **Updates `PersonaArmStats` after reward** ← integration test for the Step 3 fix
- Returns 401 without auth

**`decide.test.ts`** *(written before `/api/decide` is implemented)*
- Returns variant for known user+agent combination
- Creates `UserDecision` record
- Seeds `PersonaArmStats` at α=1,β=1 if arm not yet seen
- Returns `{ suppressed: true }` when frequency cap exceeded
- Returns `{ suppressed: true }` during quiet hours
- Assigns persona if user has no persona yet

**`cron-send.test.ts`** *(written before `/api/cron/select-and-send` is implemented)*
- Returns 401 without `CRON_SECRET`
- Calls Braze `/messages/send` for each eligible user (via `FakeBrazeTransport`)
- Records `brazeSendId` on `UserDecision`
- Skips suppressed users
- Batches ≤50 users per Braze call

### 3.4 Regression Tests (`tests/regression/`)

Named files that document specific bugs and prevent them from recurring. Each file has a comment with the bug description.

**`persona-arm-stats-updated-on-conversion.test.ts`**
```
// REGRESSION: PersonaArmStats was never updated in /api/ingest/events.
// The bandit would never learn. Fixed in production-readiness Step 3.
// This test must always pass before merge.
```

**`bandit-seeds-missing-arms.test.ts`**
```
// REGRESSION: /api/decide must seed arms at alpha=1,beta=1 for variants
// with no prior PersonaArmStats record, not skip or error.
```

### 3.5 Test Authoring Rule

Added to `CLAUDE.md` and `AGENTS.md`:

> Every new API endpoint ships with an integration test file. Every new engine function ships with a unit test file. PRs without corresponding tests for new functionality are not merged.

---

## 4. Production Readiness Execution

All steps executed TDD-style: write the tests first (they fail), implement the feature, verify tests pass, then move to the next step.

### Step 0: Infrastructure Setup (prerequisite)

1. Install devDependencies: `bun add -d husky @happy-dom/global-registrator @testing-library/jest-dom`
2. Create `bunfig.toml`, `tests/setup/`, `tests/helpers/`
3. Update `package.json` scripts
4. Create `.gitlab-ci.yml`
5. Initialize Husky + pre-push hook
6. Create Neon `nexus-test` branch, add `TEST_DATABASE_URL` to GitLab CI/CD Variables
7. Update `CLAUDE.md` and `AGENTS.md` with test authoring rule

### Step 1: Deploy the Database (Ops)

- Provision Neon `nexus-main` branch (production)
- Set `DATABASE_URL` in Vercel (production + preview environments)
- Run `npx prisma migrate deploy` against production DB
- Verify via `npx prisma studio` or a health-check query

### Step 2: Fix PersonaArmStats Update (Step 3 in prod-readiness doc)

*Tests written first in `tests/integration/ingest-events.test.ts` and `tests/regression/persona-arm-stats-updated-on-conversion.test.ts`*

In `/api/ingest/events`, after calculating reward and updating `UserDecision`:

```typescript
// After existing reward update block:
// Always update arm stats when we have a matched decision — even reward=0 counts
// as a "try" so the arm's confidence grows. Only skip if no variant was recorded.
if (decision.userId && decision.messageVariantId) {
  const user = await prisma.user.findUnique({ where: { id: decision.userId } });
  if (user?.personaId) {
    await prisma.personaArmStats.upsert({
      where: {
        personaId_agentId_variantId: {
          personaId: user.personaId,
          agentId: decision.agentId,
          variantId: decision.messageVariantId,
        }
      },
      create: {
        personaId: user.personaId,
        agentId: decision.agentId,
        variantId: decision.messageVariantId,
        alpha: reward > 0 ? 1 + reward : 1,  // seed at Thompson default α=1, add reward
        beta:  reward < 0 ? 2 : 1,            // seed at Thompson default β=1, add 1 for negative
        tries: 1,
        wins:  reward > 0 ? 1 : 0,
      },
      update: {
        alpha: reward > 0 ? { increment: reward } : undefined,
        beta:  reward < 0 ? { increment: 1 }      : undefined,
        tries: { increment: 1 },
        wins:  reward > 0 ? { increment: 1 }      : undefined,
      }
    });
  }
}
```

Note: `reward === 0` increments `tries` only — the arm gets "credit" for the observation without a win or loss signal. This is correct: it tightens the Beta distribution's variance without shifting its mean.

### Step 3: Build `/api/decide` (Step 2 in prod-readiness doc)

*Tests written first in `tests/integration/decide.test.ts`*

**Route:** `POST /api/decide`
**Auth:** Bearer `INGEST_API_KEY` (reuses ingest auth)

**Request:**
```typescript
{ agentId: string; externalUserId: string }
```

**Response (success):**
```typescript
{ data: { brazeVariantId: string; messageVariantId: string; channel: string } }
```

**Response (suppressed):**
```typescript
{ data: { suppressed: true; reason: string } }
```

**Logic (ordered):**
1. Validate `agentId` + `externalUserId` present → 400 if missing
2. Fetch agent (with messages, variants, scheduling rule) → 404 if not found or inactive
3. Lookup or create `User` by `externalUserId`
4. Call `assignUserToPersona(externalUserId)` → get `personaId`
5. If no `personaId` after assignment attempt, fall back to the largest active persona by `clusterSize DESC` (most representative) — never block a decision on persona assignment lag
6. Check scheduling rules:
   - Quiet hours → return `{ suppressed: true, reason: "quiet_hours" }`
   - Frequency cap (count UserDecisions in window) → `{ suppressed: true, reason: "frequency_cap" }`
   - Smart suppression (low reward:decision ratio) → `{ suppressed: true, reason: "smart_suppression" }`
7. Load `PersonaArmStats` for `(personaId, agentId, all active variantIds)`
8. Seed missing arms at `α=1, β=1, tries=0, wins=0` (upsert)
9. Run bandit algorithm (Thompson or Epsilon-Greedy per `agent.algorithm`)
10. Insert `UserDecision` (`agentId`, `userId`, `messageVariantId`, `channel`, `sentAt=now`)
11. Return `{ brazeVariantId, messageVariantId, channel }`

### Step 4: Build `/api/cron/select-and-send` (Step 6 in prod-readiness doc)

*Tests written first in `tests/integration/cron-send.test.ts`*

**Route:** `POST /api/cron/select-and-send`
**Auth:** `Authorization: Bearer <CRON_SECRET>`

**Logic:**
1. Verify `CRON_SECRET` header → 401 if missing/wrong
2. Instantiate `BrazeClient` via `createBrazeClient()` → 500 if not configured
3. Fetch all active agents with `AgentPersonaTarget` and `SchedulingRule`
4. For each agent:
   a. Fetch users where `personaId IN (agent's target persona IDs)`
   b. For each user, run `/api/decide` logic inline (no HTTP call — shared service function)
   c. Collect non-suppressed users grouped by variant
   d. For each variant group, batch into chunks of 50:
      - `createSendId(campaignId)` from Braze
      - `PayloadFactory.build[Channel]Payload(variant, audience, campaignId, sendId)`
      - `brazeClient.post('/messages/send', payload)`
      - On success: update `UserDecision.brazeSendId = sendId`
5. Return `{ ok: true, sent: N, suppressed: N, errors: N }`

**Scale consideration:** Stream response or set `maxDuration = 300` in route config. For >100k users per agent, process in cursor-based pages of 500.

### Step 5: Wire Vercel Cron

In `vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/select-and-send", "schedule": "0 9 * * *" }]
}
```

Set `CRON_SECRET` in Vercel environment variables.

### Step 6: Configure Hightouch (Steps 4+5 in prod-readiness doc)

*Config tasks — no code changes required*

**User sync:**
- Hightouch Model: SQL query selecting `external_user_id` + behavioral attributes from warehouse
- Destination: HTTP → `POST /api/ingest/users`, `Authorization: Bearer <INGEST_API_KEY>`
- Schedule: hourly

**Event streaming:**
- Hightouch Event Sync → `POST /api/ingest/events`, same auth
- Fields: `event_id`, `event_name`, `external_user_id`, `occurred_at`, `properties`
- Schedule: real-time or 15-minute micro-batch

### Step 7: Hightouch Signal Export (Step 7 in prod-readiness doc — post-launch)

- Export `User.personaId` + `personaConfidence` → Braze custom attributes
- Export `PersonaArmStats` winners → `nexus_preferred_variant` Braze attribute
- Export suppression signals → `nexus_suppressed` Braze attribute

---

## 5. CLAUDE.md / AGENTS.md Additions

Both files gain:

```markdown
## Testing

- Every new API endpoint → integration test in `tests/integration/`
- Every new engine function → unit test in `tests/unit/`
- Every bug fix → regression test in `tests/regression/` with comment linking to the bug
- Run `bun run test:quick` for fast feedback during development
- Run `bun run check` before opening an MR
- CI enforces all checks — MRs with failing pipelines are not merged
```

---

## 6. Definition of Done

- [ ] GitLab CI pipeline passes on every MR
- [ ] `bun run check` passes locally (typecheck + lint + all tests)
- [ ] Unit tests cover all engine functions (>95% line coverage target)
- [ ] Regression test for PersonaArmStats update passes
- [ ] `/api/decide` integration tests pass against real test DB
- [ ] `/api/cron/select-and-send` integration tests pass with `FakeBrazeTransport`
- [ ] Production DB deployed and migrations applied
- [ ] Vercel cron wired and fires on schedule
- [ ] `CLAUDE.md` and `AGENTS.md` updated with test authoring rule
