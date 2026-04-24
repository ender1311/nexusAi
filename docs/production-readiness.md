# Production Readiness — Mock to Real Users

This document describes every step required to move Nexus from its current state (mock/static UI data) to a fully operational bandit optimization system running on real users with Hightouch feeding signals in and out.

**Last updated:** 2026-04-24

---

## The Full Loop

```
Hightouch (data warehouse)
    → [sync users]       → Nexus /api/ingest/users
                         → Nexus assigns user to persona
                         → Nexus selects variant (bandit) [/api/agents/:id/decide]
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
| `/api/cron/select-and-send` | ❌ **Does not exist** — next critical code gap |
| Test suite + CI pipeline | ⚠️ Designed in MR !4 — **not yet merged to main** |
| Hightouch user sync | ❌ Ops task — not configured |
| Hightouch event streaming | ❌ Ops task — not configured |
| Braze firing | ❌ Client exists, nothing calls it — blocked on send cron |
| UI wired to real data | ❌ Mock everywhere except `/personas` — post-launch |

---

## Critical Path (Ordered)

| Step | Status | Notes |
|---|---|---|
| 0. Test infrastructure + CI | ⚠️ MR !4 pending merge | Must merge before Step 2 |
| 1. Deploy DB (ops) | ⏳ Ops — schema ready | Neon prod branch + Vercel env vars |
| 2. `/api/decide` + arm update | ✅ Done | At `/api/agents/[id]/decide`; arm stats now update |
| 3. Hightouch user sync (ops) | ⏳ Ops | HTTP destination → `/api/ingest/users` |
| 4. Hightouch event streaming (ops) | ⏳ Ops | Event sync → `/api/ingest/events` |
| 5. Build send cron | ❌ Not built | **Current code priority** |
| 6. Wire Vercel Cron | ❌ Not done | Depends on Step 5 |
| 7. Hightouch signals out | ❌ Post-launch | persona/winner attrs → Braze |

---

## Step 0 — Merge Test Infrastructure (MR !4)

**Status: ⚠️ MR !4 exists, pipeline passed, not yet merged.**

MR !4 (`feature/ci-tests-production-readiness`) adds:
- `.gitlab-ci.yml` with typecheck / lint / test / build stages
- `tests/` directory with unit, integration, contract, regression suites
- `bunfig.toml`, test helpers (db, braze fake transport, builders)
- `tests/integration/decide.test.ts`, `cron-send.test.ts`, `ingest-events.test.ts`

**Merge this before proceeding.** CI gates every future MR.

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

**Note:** New migration required — `warmupUntil` field added to `MessageVariant`. Run `prisma migrate deploy` against prod DB before deploying.

---

## Step 2 — `/api/decide` ✅ Done

`POST /api/agents/[id]/decide` is implemented. Takes `{ userId, channel? }`, returns `{ variantId, channel, explore, warmupForced, predictedReward }`.

Key behaviors:
- Thompson Sampling or Epsilon-Greedy per agent config
- Pessimistic `Beta(1,30)` prior for unseeded arms
- Forced exploration: 10% probability selects warmup variants (`warmupUntil > now`)
- Falls back to `"global"` persona key when user has no persona assignment
- Records `UserDecision` on every call

**Gap vs original spec:** The original spec called for a top-level `/api/decide` with scheduling rules (quiet hours, frequency cap) inline. The current implementation does not yet check scheduling rules inside `decide` — that logic lives in `SchedulingRule` but isn't wired to the decide endpoint. Add before production.

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
3. **Auth** — `Authorization: Bearer <INGEST_API_KEY>`
4. **Column mapping** — primary key → `external_user_id`; all attributes → `attributes` object
5. **Schedule** — Hourly (or daily; persona assignment runs on next ingest cycle)

---

## Step 5 — Set Up Hightouch Event Streaming (Ops)

**Option A — Hightouch Event Sync** (warehouse-based, ~15-min batch):
- Point at `POST /api/ingest/events`
- Map: `event_id`, `event_name`, `external_user_id`, `occurred_at`, `properties`
- Auth: same `INGEST_API_KEY` header

**Option B — Braze Currents adapter** (near-real-time):
- Build `POST /api/ingest/braze-currents` that translates Currents format → Nexus event format
- Forward to same reward calculation logic

---

## Step 6 — Build the Send Cron ❌ Not built

**This is the next critical code gap.**

**New route: `POST /api/cron/select-and-send`**

Auth: `Authorization: Bearer <CRON_SECRET>`

```typescript
// vercel.json cron entry
{ "path": "/api/cron/select-and-send", "schedule": "0 9 * * *" }
```

### Architecture (Research Complete — see `docs/research/send-cron-scale.md`)

**Decision: Vercel Workflows dispatcher + `/campaigns/trigger/send` at 50 users/request.**

- Cron fires a lightweight dispatcher (`/api/cron/select-and-send`) that publishes one job per active agent to Vercel Queues/Workflows in <5s
- Each agent-consumer Workflow: cursor-paginates `User` by `personaId` (500/page), runs bandit, calls `/campaigns/trigger/send` with `trigger_properties: { variantId }`
- Each Workflow step: 800s max (Vercel Pro); up to 10,000 steps per run → covers 2.5M users at 500/batch = 5,000 steps ✓
- Rate limit: 250,000 req/hour for `/campaigns/trigger/send` → 50,000 requests takes ~12 min ✓

**Key constraints confirmed:**
- Braze: max 50 users/request, 250k req/hour shared rate limit
- Neon: use PgBouncer pooler; disable auto-suspend on production; add indexes (see below)
- Hightouch: Lightning Sync Engine required (>100K rows); minimum interval ~15 min

**DB indexes needed (add migration before prod):**
```sql
CREATE INDEX idx_users_persona_id ON "User"("personaId");
CREATE INDEX idx_decisions_agent_user_sent ON "UserDecision"("agentId", "userId", "sentAt");
CREATE INDEX idx_arm_stats_agent_persona ON "PersonaArmStats"("agentId", "personaId");
```

### Logic (per agent-consumer workflow)

1. Cursor-paginate `User` where `personaId IN (agent.targetPersonaIds)`, 500/batch
2. For each user in batch, run `decideForUser()` (inline — no HTTP round-trip):
   - Check scheduling rules (quiet hours, frequency cap, smart suppression) via `src/lib/decide.ts`
   - Skip if suppressed
   - Run bandit selection → `variantId`
3. Batch-insert `UserDecision` records (all non-suppressed in batch)
4. Bucket non-suppressed users by `variantId`, call `/campaigns/trigger/send` at 50/request
5. On success: record `brazeSendId` on each `UserDecision`
6. Advance cursor to next page

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
INGEST_API_KEY=...

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
| Scheduling rules wired into decide | MEDIUM | ❌ Gap — needs fix before prod |
