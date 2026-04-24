# Nexus Brain

Living document. Synthesized learnings, architectural conclusions, open questions, and research-backed decisions. Updated as we research and build.

**Last updated:** 2026-04-24

---

## What We've Concluded

### The architecture is correct
Persona-clustered non-contextual Thompson Sampling is validated by industry (Deezer, Yahoo, DoorDash). Semi-personalization via k-means clusters — separate bandit per cluster — outperforms both a single global bandit and fully per-user bandits. The 50–100 cluster sweet spot gives enough feedback per model to learn quickly without losing granularity.

### Thompson Sampling is the right algorithm for our environment
Hightouch delivers reward events in batches (hours-to-days of delay). UCB fails in this environment — it's deterministic, so without fresh feedback it repeatedly picks the same arm and stops exploring. Thompson Sampling samples stochastically so it keeps exploring even when arm stats haven't updated. Yahoo's experiments quantified this: UCB degraded significantly beyond 30-minute feedback delays. TS stayed competitive at all timeframes.

### The fundamentals are now correct
After the 2026-04-24 algorithm upgrade session, the core bandit loop is production-quality:
- **Beta(1,30) pessimistic init** — calibrated to ~3% real push CTR per Deezer research. `Beta(1,1)` was implying 50% expected conversion.
- **Temporal decay (0.99/update)** — prevents old winning variants from permanently crowding out new ones. Applied to both alpha and beta before each reward update.
- **Learning loop closed** — `PersonaArmStats` now updates after every reward in `/api/ingest/events`. Previously the bandit never learned from conversions.
- **Multi-signal reward** — `push_disabled` bypasses attribution window and directly penalizes all arms from agents with sends in last 90 days. Long-horizon events (plan_completed, plan_read_day_3) use 30-day attribution window.
- **Forced exploration** — new `MessageVariant.warmupUntil` field; 10% of sends forced to warmup variants for 7 days after creation. Prevents new variants being starved by incumbent arms.

### What we should NOT build yet
- **Scheduling rules in `/api/decide`** — the decide endpoint doesn't check quiet hours or frequency caps yet. Add before production launch.
- **Fully per-user bandits** — too sparse, too slow to learn. Persona-level is right.
- **LinUCB or neural bandits** — the non-contextual system is now learning correctly. Fix fundamentals first, upgrade algorithm later.
- **LTV prediction models** — start with tiered multi-signal and see what moves metrics.

### The next critical gap is the send cron
`/api/cron/select-and-send` does not exist. Nothing fires Braze messages today. The decide logic and arm update logic are built; they just have no caller for outbound sends. Research is underway on fan-out architecture at 2.5M users (Vercel Queues vs. cursor pagination vs. Braze API-triggered campaigns).

---

## Key Numbers from Research

| Metric | Value | Source |
|---|---|---|
| Contextual bandit lift over context-free | +12.5% clicks | Yahoo (Li et al. 2010) |
| MAB opportunity cost vs A/B testing | 3–15x lower conversion loss during test | Optimizely |
| UCB degradation at 30+ min feedback delay | Significant | Yahoo experiments |
| Optimal cluster count for semi-personalization | 50–150 | Deezer, Yahoo |
| Push notification frequency at which opt-outs spike | 5–7/week (+15–25%), daily+ (3x) | Industry data |
| Pessimistic init improvement | Significant vs Beta(1,1) | Deezer |
| Features vs algorithms | Historical user features dominate | Meta (2014) |
| Temporal decay rate | 0.99/update (90% weight on last 100 updates) | Industry practice |

---

## Open Questions

- **What is the actual YouVersion push notification conversion rate?** Our Beta(1,30) prior assumes ~3%. If it's 2%, init to `Beta(1,49)`. If it's 5%, init to `Beta(1,19)`. Get this from Braze analytics before launch.
- **How many active personas are running?** 50–100 is optimal. More than ~200 = sparse feedback per model. Fewer than 20 = losing granularity.
- **Are `plan_read_day_3` events available from Hightouch?** If yes, add as a goal to agents with +0.8 weight. Currently supported in the attribution logic with 30-day window.
- **What is the actual Hightouch → Nexus event delay?** Affects whether push_disabled events are timely enough to prevent another send cycle. If delay > 24h, the suppression is late.
- **How stable are user feature vectors?** If Hightouch only syncs user attributes weekly, `recency_days` features become stale. Know the sync cadence before adding contextual features.
- **What is the actual YouVersion Braze contract tier?** The default 250,000 req/hour rate limit for `/campaigns/trigger/send` means 50,000 requests (2.5M users / 50) takes ~12 minutes. Enterprise contracts can negotiate higher. Confirm with Braze account team.
- **Do all 2.5M targeted users exist in Braze already?** `/campaigns/trigger/send` silently drops sends for users not yet in Braze. Verify before first send wave.
- **Hightouch minimum sync interval on current plan?** Standard Reverse ETL minimum is ~15 minutes. Sub-5-minute is Hightouch Real-Time (separate product). Confirm with sales.
- **Scheduling rules gap** — `/api/agents/[id]/decide` does not currently check `SchedulingRule` (quiet hours, frequency cap, smart suppression). Must be fixed before production.

---

## Architectural Decisions (Recorded)

| Decision | Rationale | Date |
|---|---|---|
| Thompson Sampling as default algorithm | Best for delayed-feedback batch environments; handles non-deterministic exploration without fresh rewards | Research confirmed 2026-04 |
| Persona-level arm stats (not per-user) | Semi-personalization validated to outperform individual; feedback density per model is key | Research confirmed 2026-04 |
| Hightouch → ingest/events → reward update | Closes the learning loop; the 48h attribution window handles delayed conversions | Design 2026-04 |
| Prisma + Neon PostgreSQL | Relational model needed for the many-to-many agent/persona/variant relationships | Architecture 2026-04 |
| Braze as send layer | Existing YouVersion relationship; API supports batched sends with send IDs for attribution | Architecture 2026-04 |
| `/campaigns/trigger/send` over `/messages/send` | Gives per-user personalization via `trigger_properties`, campaign metrics in Braze dashboard, marketers edit copy without deployment | Research confirmed 2026-04 |
| Connected Content (pull model) rejected for mass sends | 2.5M synchronous calls to Nexus during send window; 2s timeout too tight for cold Vercel functions; no atomic decision recording | Research confirmed 2026-04 |
| Vercel Workflows for send fan-out | Dispatcher cron publishes per-agent jobs; each workflow cursor-paginates users; no total execution time limit; 10,000 steps/run fits 2.5M/500-batch pattern | Research confirmed 2026-04 |
| Keyset pagination for user scans | `OFFSET` is O(n) at 2.5M rows; cursor-based `WHERE id > $cursor LIMIT 500` stays O(log n) | Research confirmed 2026-04 |
| Beta(1,30) pessimistic prior | Calibrated to ~3% push CTR; Beta(1,1) was implying 50% — caused noisy exploration | Implemented 2026-04 |
| 0.99 temporal decay on arm updates | Prevents inflated-alpha incumbents from crowding out newer variants; industry-standard rate | Implemented 2026-04 |
| 30-day attribution window for plan events | Plan completion takes days-weeks; 48h window was missing most conversions | Implemented 2026-04 |
| push_disabled bypasses attribution window | Opt-out is a user-level permanent signal, not attributable to a single decision | Implemented 2026-04 |
| warmupUntil forced exploration | New variants at Beta(1,30) would rarely beat incumbents at Beta(500,100); forced 10% traffic for 7 days equalizes opportunity | Implemented 2026-04 |
| Persona migration endpoint (atomic tx) | Deactivating a persona without nulling User.personaId left users pointing at inactive personas; migration must be a single transaction | Implemented 2026-04 |

---

## Research Log

| Date | Topic | Key Finding | File |
|---|---|---|---|
| 2026-04-24 | AI decisioning for engagement/conversion | Beta init, temporal decay, contextual features, multi-signal rewards are top gaps | [research/ai-decisioning.md](research/ai-decisioning.md) |
| 2026-04-24 | Send cron scale + Hightouch + Braze at 2.5M users | Vercel Workflows dispatcher + `/campaigns/trigger/send` 50/req; Hightouch Lightning Sync at 15min; Neon needs indexes + pooler | [research/send-cron-scale.md](research/send-cron-scale.md) |

---

## What's Been Built (as of 2026-04-24)

### Core bandit loop
- ✅ Thompson Sampling + Epsilon-Greedy engines (pure functions, unit-testable)
- ✅ PersonaArmStats learning loop closed (temporal decay, pessimistic init)
- ✅ Multi-signal reward (push_disabled, long-horizon attribution)
- ✅ Forced exploration (warmupUntil field + 10% warmup traffic)

### API endpoints
- ✅ `POST /api/ingest/users` — Hightouch user sync target
- ✅ `POST /api/ingest/events` — reward ingestion with full learning loop
- ✅ `POST /api/agents/[id]/decide` — bandit variant selection
- ✅ `GET /api/agents/[id]/arm-health` — arm stats freshness monitoring
- ✅ `POST /api/personas/migrate` — safe persona list changes
- ✅ `POST /api/personas/discover` — k-means persona clustering
- ✅ CRUD: agents, messages, variants, goals, personas, settings

### Still missing for production
- ❌ `POST /api/cron/select-and-send` — Braze send trigger (critical path)
- ❌ Scheduling rules wired into decide (quiet hours, frequency cap)
- ❌ Test suite (MR !4 pending merge)
- ❌ `.gitlab-ci.yml` (MR !4 pending merge)
