# Send Cron Scale — Research Findings

**Date:** 2026-04-24
**Scope:** Send architecture at 2.5M users, Hightouch integration, Braze API, Neon at scale

---

## Decision

**Use Vercel Workflows + `/campaigns/trigger/send` with `trigger_properties`.**

- Cron fires a lightweight dispatcher (≤5s) that publishes one message per active agent to Vercel Queues
- Each agent-consumer workflow: cursor-paginates Neon → runs bandit per user → calls `/campaigns/trigger/send` at 50 users/request
- Reward loop: Hightouch Lightning Sync Engine reads conversion events from Neon warehouse, sends batches of 100 to `/api/ingest/events` with Bearer auth

---

## 1. Vercel Cron + Fluid Compute Limits

| Plan | Default max | Max with Fluid Compute |
|------|-------------|------------------------|
| Hobby | 300s | 300s (hard cap) |
| Pro | 300s | 800s |
| Enterprise | 300s | 800s |

- `maxDuration = 800` set per-route in Next.js App Router
- Cron jobs share the same limits as regular functions
- Vercel does **not retry** a failed cron invocation
- Streaming the response does NOT extend the compute timeout
- If a cron runs longer than its interval, Vercel can trigger a second instance concurrently — use a Redis distributed lock or idempotency check

**Implication:** A single function processing 2.5M users is impossible. The cron must be a dispatcher only.

---

## 2. Fan-Out Architecture Options

### Option A: Vercel Workflows (Recommended)

Built on Vercel Queues. Key limits:

| Limit | Value |
|-------|-------|
| Steps per run | 10,000 |
| Max individual step runtime | 800s (Vercel Function limit) |
| Max total run duration | No limit |
| Max `sleep` duration | No limit |
| Run creations per second | 1,000 |
| Pro requests/minute | 1,000,000 |

**Pricing:** $2.50 per 100,000 steps. 7-day retention on Pro.

**Why Workflows over raw Queues:** Sequential steps (fetch → bandit → send → record) map naturally to Workflow steps. Each step has retry semantics, observability, and state persistence. No total execution time limit.

**Fan-out math:**
- 5 active agents = 5 workflow runs
- Each run: 2.5M / 500 users/batch = 5,000 pages → 5,000 `step.run()` calls
- If each step calls Braze 500/50 = 10 times → 50,000 Braze calls/agent total
- 5,000 steps < 10,000 step limit ✓
- Larger agents may need to spawn child workflow runs

### Option B: Vercel Queues (Lower-level)

- At-least-once delivery, three-zone replication
- Max message size: 100 MB; default retention: 24h
- Max client connections: 10,000 (client-side to PgBouncer equivalent)
- Push mode: Vercel auto-invokes consumer functions per message
- No `maxDuration` extension beyond Vercel Function limits

Good if you need the raw messaging primitive; Workflows is better for the sequential send pipeline.

### Option C: Inngest (Third-party)

- Native Next.js integration via `/api/inngest` route
- Checkpointing bypasses 800s Vercel limit per step
- Pro: $75+/month, 100+ concurrent steps; Enterprise: 500–50,000
- Introduces third-party dependency + external orchestration plane
- Your `/api/inngest` endpoint must be publicly accessible

### Option D: Trigger.dev v3

- Runs on Trigger.dev's own infrastructure (not Vercel functions)
- No execution time limit on cloud; `batchTrigger()` supports 1,000 runs per call
- Pro: $50/month, 200 concurrent runs
- Bigger architectural change — code deploys to Trigger's workers, not Vercel

---

## 3. Braze API Limits

### `/campaigns/trigger/send` (Recommended pattern)

```json
{
  "campaign_id": "...",
  "recipients": [
    { "external_user_id": "user_123", "trigger_properties": { "variant_id": "v2", "headline": "Read the Psalms" } },
    ...
  ]
}
```

| Limit | Value |
|-------|-------|
| Max users per request | **50** |
| Rate limit (shared with /messages/send, /canvas/trigger/send) | **250,000 req/hour** |
| Sustained throughput | ~69 requests/second |

**Math:** 2.5M users / 50 per request = 50,000 requests. At 250k/hour, this takes ~12 minutes — within budget.

**Advantages over raw `/messages/send`:**
- Campaign metrics tracked in Braze dashboard (CTR, conversions)
- Message copy in Braze dashboard (marketers can edit without deployment)
- `trigger_properties` provides full per-user personalization

**Important:** Braze requires users to already exist before sending. Verify all targeted users are pre-loaded in Braze.

### Connected Content (Pull model) — Rejected for mass sends

Braze calls Nexus per-user at send time: `{% connected_content https://nexus.../api/decide?user_id={{...}} :save result %}`.

Problems at 2.5M scale:
- 2.5M synchronous HTTP calls hit Nexus during send window
- 2-second connection timeout — Vercel cold starts will miss this
- No atomic decision recording
- Verdict: **use only for <10K-user, high-personalization use cases**

---

## 4. Hightouch Integration

### HTTP Request Destination

- Batch mode: 100 rows per request (configurable)
- Liquid templating for payload construction: `{{row.column_name}}`
- Add `Authorization: Bearer {{secret_token}}` header, mark as Secret to encrypt at rest
- Configure batch size to match `/api/ingest/events` expected format

### Event Sync Latency

- Hightouch is a **batch** Reverse ETL tool — standard minimum interval: ~15 minutes
- Sub-5-minute delivery not achievable via scheduled syncs; requires Hightouch Real-Time product
- **Lightning Sync Engine required** for >100K rows (CDC within Neon, up to 100x faster)
- Lightning Engine needs read+write access to Neon to create `hightouch_planner` and `hightouch_audit` schemas

### Neon as Hightouch Source

- Hightouch supports PostgreSQL ≥ 15 (Neon runs PG15/16 — compatible)
- Use Neon pooler connection string; add `&connect_timeout=15` to handle auto-suspend cold starts
- Give Hightouch a dedicated Neon role with read access to relevant tables + write access to `hightouch_planner` schema

---

## 5. Neon at Scale

### Connection Pooling

PgBouncer is **built into Neon** — enable with `-pooler` hostname suffix:
```
postgresql://user:pass@endpoint-pooler.region.aws.neon.tech/db?sslmode=require
```

| Compute | `max_connections` | Pooler pool size |
|---------|-------------------|-----------------|
| 0.5 CU | 209 | ~188 |
| 1 CU | 419 | ~377 |
| 2 CU | 839 | ~755 |
| 9+ CU | 4,000 (capped) | ~3,600 |

- Pool mode: **transaction** — session-level features (`SET`, `PREPARE`) are unavailable
- Max client connections to PgBouncer: 10,000
- At 30,000 concurrent Vercel functions (Workflows auto-scale), connection contention is a risk — configure `maxDuration` and set connection limits at the application level

### Auto-Suspend

- Default: suspends after 5 minutes of inactivity
- **Disable auto-suspend on production** (Scale plan supports this; ~$155/month at 2 CU always-on)
- Pre-warm 5 minutes before cron fires if auto-suspend is left on

### Indexes Required (not yet in migration)

```sql
-- User → persona fan-out
CREATE INDEX idx_users_persona_id ON "User"("personaId");

-- Frequency cap check
CREATE INDEX idx_decisions_agent_user_sent ON "UserDecision"("agentId", "userId", "sentAt");

-- Arm stats lookup
CREATE INDEX idx_arm_stats_agent_persona ON "PersonaArmStats"("agentId", "personaId");
```

### Keyset Pagination (mandatory for 2.5M user scans)

Use cursor-based pagination — OFFSET is O(n):
```sql
SELECT * FROM "User" WHERE "personaId" = $1 AND id > $cursor ORDER BY id LIMIT 500
```

---

## 6. Open Questions (Confirmed Pre-Launch Tasks)

| Question | Who | Priority |
|----------|-----|----------|
| What is YouVersion's actual push CTR? (calibrates Beta prior) | Analytics | HIGH |
| Does YouVersion have an Enterprise Braze contract? (affects rate limits) | Account mgr | HIGH |
| Verify Lightning Sync Engine write access is acceptable on prod Neon | Ops | HIGH |
| Minimum Hightouch sync interval on our plan | Hightouch sales | MEDIUM |
| Vercel Workflows throughput ceiling at 2.5M messages | Vercel Enterprise | MEDIUM |
| Neon IP allowlisting requirement for Hightouch | Ops | MEDIUM |
| Do all 2.5M targeted users exist in Braze already? | Analytics | HIGH |
| Braze campaign pre-provisioning workflow (manual vs. API) | Product | MEDIUM |

---

## Architecture Summary

```
Vercel Cron (9am UTC, Pro plan)
  └─► Dispatcher function (<5s)
        └─► Publishes 1 message per active agent to Vercel Queues

Each agent-consumer Workflow:
  └─► Cursor-paginate User table by personaId, 500 users/batch
  └─► For each batch:
        ├─► Run Thompson Sampling / Epsilon-Greedy per user
        ├─► Batch insert UserDecision records (batch write)
        └─► POST /campaigns/trigger/send (50 users/call, trigger_properties: {variantId})
  └─► Continue until cursor exhausted (~5,000 steps for 2.5M users)

Reward loop (Hightouch Lightning Sync, ~15min latency):
  └─► SQL model reads conversion events since watermark
  └─► HTTP Destination → POST /api/ingest/events (100 events/batch)
  └─► PersonaArmStats updated with temporal decay (bandit learns)
```
