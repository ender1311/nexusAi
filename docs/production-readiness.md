# Production Readiness — Mock to Real Users

This document describes every step required to move Nexus from its current state (mock/static UI data) to a fully operational bandit optimization system running on real users with Hightouch feeding signals in and out.

**Last updated:** 2026-04-24 (refreshed against repo)

**Variable template:** see [`.env.example`](../.env.example) for local and Vercel naming.

---

## Go-live checklist (engineering + ops)

Work through in order before turning on Hightouch sync and the send cron against production users.

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Neon production branch created; `DATABASE_URL` set in Vercel (Preview/Production as needed) | Ops | ⏳ |
| 2 | `npx prisma migrate deploy` run against that database (CI does this for `TEST_DATABASE_URL`; prod is manual or release job) | Ops / Eng | ⏳ |
| 3 | `HIGHTOUCH_API_KEY`, `CRON_SECRET`, `BRAZE_*` set in Vercel; keys rotated if pre-shared | Ops | ⏳ |
| 4 | GitLab: `TEST_DATABASE_URL` + green pipeline on `main` | Eng | ⏳ |
| 5 | Production deploy succeeds (`bun run build`); smoke: `GET /api/agents` (dashboard) | Eng | ⏳ |
| 6 | Hightouch → `POST /api/ingest/users` (hourly/daily) with Bearer `HIGHTOUCH_API_KEY` | Ops | ⏳ |
| 7 | Hightouch or warehouse → `POST /api/ingest/events` for conversion events | Ops | ⏳ |
| 8 | Agent(s) **active** in DB; messages have real `brazeCampaignId` / variant IDs where required | Eng / PM | ⏳ |
| 9 | First `POST /api/cron/select-and-send` with `Authorization: Bearer <CRON_SECRET>` in dry window; confirm Braze sends + `UserDecision.brazeSendId` | Eng | ⏳ |
| 10 | Vercel Cron enabled; watch logs at scheduled time ([`vercel.json`](../vercel.json) — `0 9 * * *` UTC) | Ops | ⏳ |
| 11 | Post-launch: persona / winner attributes back to Braze via Hightouch (Step 7 below) | Ops | Post-launch |

**Local / CI database:** `prisma.config.ts` loads `.env` then `.env.local` (override), matching Next.js. Run `npx prisma migrate deploy` against the same `DATABASE_URL` you use for `bun run test` so integration tests do not drift from the schema.

---

## The Full Loop

```
Hightouch (data warehouse)
    → [sync users]       → Nexus /api/ingest/users
                         → Nexus assigns user to persona
                         → Nexus selects variant (bandit)
                            • POST /api/decide { agentId, externalUserId } (Hightouch-friendly)
                            • POST /api/agents/:id/decide { userId, channel? } (dashboard / internal)
                         → Braze sends message to user [/api/cron/select-and-send]
                         → User converts (app event)
                         → Event warehouse / Braze Currents
    → [stream events]    → Nexus /api/ingest/events
                         → Reward calculated + stored
                         → PersonaArmStats updated (bandit learns) ✅
                         → Loop
```

---

## Gap Analysis — Current State

| What | Status |
|---|---|
| PostgreSQL DB + schema | ✅ Schema + migrations ready — **needs ops deploy** |
| `/api/ingest/users` | ✅ Working |
| `/api/ingest/events` — arm update | ✅ Fixed: PersonaArmStats updated with 0.99 temporal decay |
| `/api/ingest/events` — multi-signal | ✅ `push_disabled` bypass, 30-day window for plan events |
| `/api/agents/[id]/decide` | ✅ Built: Thompson/EpsilonGreedy + forced exploration for warmup variants |
| `/api/agents/[id]/arm-health` | ✅ Built: health status + per-variant stats freshness |
| `/api/personas/migrate` | ✅ Built: atomic deactivation/activation with user reassignment |
| Beta initialization | ✅ Fixed: `Beta(1,30)` pessimistic prior (was `Beta(1,1)`) |
| `POST /api/decide` | ✅ Built: wraps `decideForUser()` — scheduling + bandit + `UserDecision` |
| `/api/cron/select-and-send` | ✅ Built: pages users (500), `decideForUser` + Braze `/messages/send`, batches of 50, `maxDuration` 300s |
| Vercel cron config | ✅ [vercel.json](../vercel.json) — `0 9 * * *` → `/api/cron/select-and-send` |
| Test suite + CI pipeline | ✅ `.gitlab-ci.yml`, `tests/` (unit, contracts, integration, regression), Husky `pre-push` → `check:quick` |
| Hightouch user sync | ❌ Ops task — not configured |
| Hightouch event streaming | ❌ Ops task — not configured |
| Braze firing | ⏳ **Code path exists** (cron) — needs prod `BRAZE_*`, `CRON_SECRET`, deployed app |
| UI wired to real data | ❌ Mock everywhere except `/personas` — post-launch |

---

## Critical Path (Ordered)

| Step | Status | Notes |
|---|---|---|
| 0. Test infrastructure + CI | ✅ In repo | `.gitlab-ci.yml`, `bunfig.toml`, `tests/`, Husky pre-push |
| 1. Deploy DB (ops) | ⏳ Ops — schema ready | Neon prod branch + Vercel `DATABASE_URL` + `prisma migrate deploy` |
| 2. Decide + arm update | ✅ Done | `/api/decide`, `/api/agents/[id]/decide`, `decideForUser`; ingest updates arms |
| 3. Hightouch user sync (ops) | ⏳ Ops | HTTP destination → `/api/ingest/users` |
| 4. Hightouch event streaming (ops) | ⏳ Ops | Event sync → `/api/ingest/events` |
| 5. Send cron + Braze sends | ✅ Code done | `/api/cron/select-and-send`; prod needs secrets + monitoring |
| 6. Wire Vercel Cron | ✅ Done | [vercel.json](../vercel.json) |
| 7. Hightouch signals out | ❌ Post-launch | persona/winner attrs → Braze |

---

## Step 0 — Test Infrastructure + CI ✅

Present in the repository:

- **CI:** [`.gitlab-ci.yml`](../.gitlab-ci.yml) — stages `verify` → `build` (only on `main`). Each verify job runs `bun install --frozen-lockfile`. `verify:test` sets `DATABASE_URL: $TEST_DATABASE_URL` and inline test values for `HIGHTOUCH_API_KEY`, `CRON_SECRET`, `BRAZE_*`, then `prisma migrate deploy` + `bun run test`.
- **Tests:** `tests/unit`, `tests/contracts`, `tests/integration`, `tests/regression`; helpers under `tests/helpers/`
- **Config:** `bunfig.toml`, `package.json` scripts `test`, `test:quick`, `check`, `check:quick`
- **Hooks:** `.husky/pre-push` runs `bun run check:quick`

**GitLab CI/CD variables:** set `TEST_DATABASE_URL` (Neon branch used only for CI). Keep pipelines green on MRs and `main`.

---

## Step 1 — Deploy the Database (Ops)

The PostgreSQL migration is ready. Point `DATABASE_URL` at Neon production.

```bash
# Create Neon production branch (nexus-main)
# Then:
DATABASE_URL=postgresql://... npx prisma migrate deploy
npx prisma generate
```

Set `DATABASE_URL` in Vercel environment variables for all environments.

**Note:** Apply all migrations in `prisma/migrations/` (including `MessageVariant.warmupUntil` and any newer) with `prisma migrate deploy` before or as part of each production deploy.

---

## Step 2 — Decide endpoints ✅ Done

**`POST /api/agents/[id]/decide`** — dashboard / agent-scoped API. Takes `{ userId, channel? }`, returns variant selection metadata (Thompson/Epsilon-Greedy, warmup exploration, arm health context).

**`POST /api/decide`** — Hightouch-friendly entry: `{ agentId, externalUserId }`, Bearer `HIGHTOUCH_API_KEY`. Delegates to **`decideForUser()`** in `src/lib/decide.ts`.

Shared **`decideForUser()`** behavior:

- Loads agent, messages, active variants, and `schedulingRule`
- Resolves persona (assignment, then largest active persona fallback)
- **Scheduling:** quiet hours, frequency cap, smart suppression (unless `skipSchedulingChecks` — used by cron after bulk checks)
- Seeds / upserts `PersonaArmStats`, runs bandit algorithm, writes `UserDecision`
- Returns `{ suppressed: true, reason }` or variant ids + channel + `userDecisionId`

Cron path: `src/app/api/cron/select-and-send/route.ts` pre-checks quiet hours per agent, bulk frequency cap and smart suppression per user page, then calls `decideForUser(..., skipSchedulingChecks: true)`.

---

## Step 3 — Reward Loop in `/api/ingest/events` ✅ Done (with improvements)

`PersonaArmStats` is now updated after every reward. Improvements beyond original plan:

1. **Temporal decay** — `alpha = 1 + (alpha-1) * 0.99` on each update prevents old data from locking in winners
2. **Pessimistic init** — New arms created at `Beta(1, 30)` not `Beta(1, 1)`
3. **`push_disabled` bypass** — Skips attribution window, applies `-1.0` reward to all arms from agents with sends in last 90 days
4. **Long-horizon events** — `plan_completed`, `plan_read_day_3`, `plan_read_day_7` use 30-day attribution window instead of 48h

---

## Step 4 — Set Up Hightouch User Sync (Ops)

In Hightouch:
1. **Model** — SQL query: `external_user_id` + behavioral attributes flat per user
2. **Destination** — HTTP Request → `POST https://nexus.vercel.app/api/ingest/users`
3. **Auth** — `Authorization: Bearer <HIGHTOUCH_API_KEY>`
4. **Column mapping** — primary key → `external_user_id`; all attributes → `attributes` object
5. **Schedule** — Hourly (or daily; persona assignment runs on next ingest cycle)

---

## Step 5 — Set Up Hightouch Event Streaming (Ops)

**Option A — Hightouch Event Sync** (warehouse-based, ~15-min batch):
- Point at `POST /api/ingest/events`
- Map: `event_id`, `event_name`, `external_user_id`, `occurred_at`, `properties`
- Auth: same `HIGHTOUCH_API_KEY` header

**Option B — Braze Currents adapter** (near-real-time):
- Build `POST /api/ingest/braze-currents` that translates Currents format → Nexus event format
- Forward to same reward calculation logic

---

## Step 6 — Send Cron ✅ Implemented

**Route:** `POST /api/cron/select-and-send` (`src/app/api/cron/select-and-send/route.ts`)

**Auth:** `Authorization: Bearer <CRON_SECRET>` (required in production — no fallback if unset)

**Vercel:** `export const maxDuration = 300`; cron schedule in [vercel.json](../vercel.json): `0 9 * * *`

**Current implementation (single invocation):**

1. Loads active agents with persona targets, scheduling rules, messages, and active variants
2. Per agent: skip entirely if quiet hours apply (agent-level check)
3. Pre-seeds `PersonaArmStats` for each target persona × variant (reduces races)
4. Cursor-paginates users with `personaId IN (target personas)`, **500 per page**
5. Bulk frequency-cap and smart-suppression filtering; then concurrent `decideForUser(..., preloadedAgent, skipSchedulingChecks: true)` (concurrency 10 within each page)
6. Groups recipients by variant; calls Braze **`/messages/send`** via `BrazeClient` + `PayloadFactory` in batches of **50**
7. On success, sets `UserDecision.brazeSendId` from `createSendId`
8. Response: `{ ok, sent, suppressed, errors }`

**Production checklist:** Set `CRON_SECRET`, `BRAZE_API_KEY`, `BRAZE_REST_URL`, and campaign/variant IDs on messages so sends succeed. Watch Vercel logs and Braze dashboards for first runs.

### Scale / future architecture

For very large audiences (multi-million users per run), a dispatcher + **Vercel Queues / Workflows** (or chunked cron invocations) may be needed so a single function stays within time limits. Research notes: `docs/research/send-cron-scale.md`.

**DB indexes (recommended before high volume — add via Prisma migration if profiling shows need):**

```sql
CREATE INDEX idx_users_persona_id ON "User"("personaId");
CREATE INDEX idx_decisions_agent_user_sent ON "UserDecision"("agentId", "userId", "sentAt");
CREATE INDEX idx_arm_stats_agent_persona ON "PersonaArmStats"("agentId", "personaId");
```

**Operational constraints (unchanged):**

- Braze: max 50 recipients per `/messages/send` request; shared REST rate limits
- Neon: pooler, avoid auto-suspend surprises on prod
- Hightouch: Lightning Sync Engine for very large models; ~15 min minimum batch interval typical

---

## Step 7 — Hightouch Signals Back Out (Post-Launch)

Once arm stats accumulate:

**7a — Persona Assignments → Braze**
- Hightouch reads `User.personaId` + `User.personaConfidence` from Nexus DB
- Syncs `nexus_persona_id` as Braze custom attribute
- Enables Braze segmentation by persona

**7b — Winning Variants → Braze**
- Hightouch reads `PersonaArmStats` — when `alpha / (alpha + beta)` is significantly higher for one variant, that's the winner
- Syncs `nexus_preferred_variant` per persona to Braze

**7c — Suppression Lists**
- Users with poor reward ratio → `nexus_suppressed: true` Braze attribute
- Add to Braze canvas exit criteria

---

## Environment Variables Checklist

Copy from [`.env.example`](../.env.example) into Vercel (and local `.env.local`). Required for the full loop:

```bash
# Database
DATABASE_URL=postgresql://...

# Braze
BRAZE_API_KEY=...
BRAZE_REST_URL=rest.iad-01.braze.com
BRAZE_ANDROID_APP_ID=...
BRAZE_IOS_APP_ID=...
BRAZE_WEB_APP_ID=...

# Ingest security (Hightouch uses this as Bearer token)
HIGHTOUCH_API_KEY=...

# Cron security
CRON_SECRET=...
```

---

## Algorithm Upgrades Status

These were identified in `docs/research/ai-decisioning.md` and affect production performance:

| Upgrade | Priority | Status |
|---|---|---|
| Beta(1,30) pessimistic init | HIGH | ✅ Done |
| Temporal decay (0.99/update) | HIGH | ✅ Done |
| PersonaArmStats learning loop | HIGH | ✅ Done |
| `push_disabled` negative reward | HIGH | ✅ Done |
| Forced exploration (warmupUntil) | HIGH | ✅ Done |
| Arm health monitoring endpoint | HIGH | ✅ Done |
| Persona migration endpoint | HIGH | ✅ Done |
| Long-horizon attribution (30-day) | MEDIUM | ✅ Done |
| Per-user preferred send hour | MEDIUM | ❌ Tier 2 — post-launch |
| Recency-weighted frequency suppression | MEDIUM | ❌ Tier 2 — post-launch |
| Contextual features (recency × persona) | MEDIUM | ❌ Tier 3 — post-launch |
| Scheduling rules wired into decide | MEDIUM | ✅ Done (`decideForUser` + cron bulk checks) |
