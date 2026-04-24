# Nexus Brain

Living document. Synthesized learnings, architectural conclusions, open questions, and research-backed decisions. Updated as we research and build.

---

## What We've Concluded

### The architecture is correct
Persona-clustered non-contextual Thompson Sampling is validated by industry (Deezer, Yahoo, DoorDash). Semi-personalization via k-means clusters — separate bandit per cluster — outperforms both a single global bandit and fully per-user bandits. The 50–100 cluster sweet spot gives enough feedback per model to learn quickly without losing granularity.

### Thompson Sampling is the right algorithm for our environment
Hightouch delivers reward events in batches (hours-to-days of delay). UCB fails in this environment — it's deterministic, so without fresh feedback it repeatedly picks the same arm and stops exploring. Thompson Sampling samples stochastically so it keeps exploring even when arm stats haven't updated. Yahoo's experiments quantified this: UCB degraded significantly beyond 30-minute feedback delays. TS stayed competitive at all timeframes.

### The biggest near-term gaps
Ranked by estimated impact:

1. **Beta initialization is wrong** — `Beta(1,1)` implies 50% expected reward rate. Realistic push conversion rates are 2–5%. Pessimistic initialization (Deezer: `Beta(1, ~20–30)`) significantly reduces the noisy warm-up period and reaches exploitation faster. *1-line fix.*

2. **No temporal decay** — PersonaArmStats accumulates forever. Old winning variants crowd out new ones. A variant that was dominant 18 months ago still carries inflated alpha. Sliding window or exponential decay (~0.99/update) is the fix.

3. **Single reward signal is fragile** — Optimizing only for `plan_started` is Goodhart's Law waiting to happen. The system will find message copy that drives clicks but not sustained engagement. Need: `plan_started` + delayed reads + push opt-outs as negative signals + long-term retention signal.

4. **No arm health monitoring** — If Hightouch stops sending events, PersonaArmStats silently stops updating. The bandit keeps making decisions but never learns. Need: alert if no arm stat updates in >24h per agent.

5. **Contextual features are missing at decision time** — The current bandit is non-contextual within a persona. A lapsed user and an active user in the same persona get the same variant selection logic. Adding 3–5 contextual features (recency bucket, time of day, channel preference) is the next major lift — Yahoo's contextual LinUCB showed 12.5% click lift over context-free bandit.

### What we should not over-engineer
- Fully per-user bandits — too sparse, too slow to learn. Persona-level is right.
- LinUCB or neural bandits right now — the non-contextual system isn't yet learning correctly (bad init, no decay). Fix the fundamentals first.
- Complex reward attribution — start with tiered multi-signal and see what moves metrics before building LTV prediction models.

---

## Key Numbers from Research

| Metric | Value | Source |
|---|---|---|
| Contextual bandit lift over context-free | +12.5% clicks | Yahoo (Li et al. 2010) |
| MAB opportunity cost vs A/B testing | 3–15x lower conversion loss during test | Optimizely |
| UCB degradation at 30+ min feedback delay | Significant | Yahoo experiments |
| Optimal cluster count for semi-personalization | 50–150 | Deezer, Yahoo |
| Push notification frequency at which opt-outs spike | 5–7/week (+15–25%), daily+ (3x) | Industry data |
| Pessimistic init improvement | Significant | Deezer |
| Features vs algorithms | Historical user features dominate | Meta (2014) |

---

## Open Questions

- **What is the actual conversion rate for YouVersion push notifications?** This determines the correct pessimistic Beta prior. If it's 3%, init to `Beta(1, 32)`.
- **How many personas are currently running?** Research says 50–100 is optimal. If we're at 5–10, we're likely leaving signal on the table.
- **Are we getting plan_read_day_3 events from Hightouch?** These should be added to the reward function.
- **What's the delay between send and Hightouch reward events arriving?** This affects whether UCB would have been a problem (it would — TS was the right choice).
- **How stable are user feature vectors?** If Hightouch only syncs user attributes weekly, recency-based features are stale and less useful.

---

## Architectural Decisions (Recorded)

| Decision | Rationale | Date |
|---|---|---|
| Thompson Sampling as default algorithm | Best for delayed-feedback batch environments; handles non-deterministic exploration without fresh rewards | Research confirmed 2026-04 |
| Persona-level arm stats (not per-user) | Semi-personalization validated to outperform individual; feedback density per model is key | Research confirmed 2026-04 |
| Hightouch → ingest/events → reward update | Closes the learning loop; the 48h attribution window handles delayed conversions | Design 2026-04 |
| Prisma + Neon PostgreSQL | Relational model needed for the many-to-many agent/persona/variant relationships | Architecture 2026-04 |
| Braze as send layer | Existing YouVersion relationship; API supports batched sends with send IDs for attribution | Architecture 2026-04 |

---

## Research Log

| Date | Topic | Key Finding | File |
|---|---|---|---|
| 2026-04-24 | AI decisioning for engagement/conversion | Beta init, temporal decay, contextual features, multi-signal rewards are top gaps | [research/ai-decisioning.md](research/ai-decisioning.md) |
