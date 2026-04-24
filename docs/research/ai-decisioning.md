# Research: AI Decisioning for Engagement & Conversion
**Date:** 2026-04-24
**Use case:** Push notification / email / in-app message optimization for YouVersion (Bible app, ~500M users)
**Bandit system:** Nexus — persona-clustered Thompson Sampling with Hightouch reward ingestion

---

## 1. Algorithm Comparison

### Thompson Sampling vs UCB vs Epsilon-Greedy

**Thompson Sampling (TS):**
- Implements "probability matching" — arm selection probability tracks the probability it's actually optimal
- Stochastic: samples from Beta posteriors each time, so it explores even when arm stats are stale
- Best for delayed feedback environments (Yahoo: TS stayed competitive at 10/30/60-min delays while UCB degraded beyond 30 min)
- Stitch Fix: preferred TS over ε-greedy for "convergence and instantaneous self-correction"
- Handles batch updates naturally; the randomness keeps exploration alive between updates

**UCB (Upper Confidence Bound):**
- Deterministic: always picks the arm with highest (estimated mean + uncertainty bonus)
- Fails with delayed/batched feedback — without new rewards, it repeatedly picks the same arm and stops exploring
- Good when feedback is near-instant (sub-minute)
- UCB1 regret: O(log T) — theoretically optimal, but empirically weaker with delays

**Epsilon-Greedy:**
- Simple: explore uniformly at random with probability ε, exploit otherwise
- May waste exploration on known-bad arms
- Spotify chose it for simplicity of propensity scoring in their pipeline
- Appropriate when you need easy offline counterfactual evaluation
- ε annealing (decay over time) improves performance; flat ε is suboptimal

**Verdict for Nexus:** TS is correct. Hightouch batches mean feedback is delayed hours-to-days. TS is the only standard algorithm that handles this gracefully.

---

## 2. Semi-Personalization via Clustering

**The key finding (Deezer):**
Clustering users into 100 groups (k-means) with a separate bandit per cluster **outperformed fully individualized bandits**. Why: feedback density. Each cluster-level bandit accumulates enough observations to learn quickly. Per-user bandits are too sparse.

**Yahoo's approach:**
- 1,200 user features → reduced to 5 clusters via PCA before applying LinUCB
- Dimensionality reduction was essential for performance and speed

**Optimal cluster count:** 50–150 for large user bases. Each cluster should see ≥50 conversion events per week for stable learning. More than ~200 clusters = sparse feedback = slow convergence.

**Nexus alignment:** ✅ Correct architecture. Persona-level arm stats is the right unit. Tune cluster count to hit the feedback density target.

---

## 3. Beta Initialization

**Deezer finding:**
Pessimistic initialization — `Beta(1, 99)` — significantly outperformed `Beta(1, 1)`. Reason: `Beta(1,1)` implies 50% expected reward, which is wildly optimistic for push notifications (~2–5% actual conversion rates). Pessimistic init converges faster to exploitation.

**Rule of thumb:**
If historical conversion rate is ~r, initialize as `Beta(1, (1-r)/r)`. E.g., r=3% → `Beta(1, ~32)`.

**DoorDash hierarchical warm-start:**
1. Start with a weak prior
2. Increment using aggregate data for the category/vertical
3. Personalize per-cluster
Result: high-quality recommendations from day one instead of a random exploration period.

**Nexus gap:** Currently `alpha=1, beta=1` for all new arm stats. This causes a noisy, over-exploring warm-up phase. Fix: calibrate from historical Braze send analytics.

---

## 4. Reward Signal Design

**Meta (Facebook, 2014):**
- Historical user features dominate all other signal types
- Feature engineering > algorithm complexity
- "The most important thing is having the right features: those capturing historical information about the user or ad dominate other types"
- Even a small feature quality improvement outweighs a more complex algorithm

**Goodhart's Law risk:**
Optimizing a single proxy metric (e.g., `plan_started`) creates pressure for the system to find messages that maximize that metric regardless of real value. Examples:
- Sensational/clickbait copy → high starts, low completion, churn
- Easy-convert users get all the traffic → hard-to-convert users never reached
- Short-term engagement spikes → long-term retention damage

**Stitch Fix's solution:**
Separate outcomes from rewards. Use a pre-trained LTV (lifetime value) model to estimate long-term value from short-term signals. The bandit optimizes for LTV estimate, not raw click.

**RLHF parallel:**
Without a penalty on divergence from baseline, the system finds messages that "fool" the reward signal. Solution: include negative reward signals (opt-outs, disengagement) to constrain optimization.

**Multi-signal reward hierarchy (recommended for Nexus):**
```
reward = plan_started_within_24h × 1.0
       + plan_read_day_3          × 0.8   (attributed via session)
       + plan_completed           × 1.5
       + no_action_within_72h     × -0.3
       + push_disabled            × -2.0  (permanent opt-out signal)
```

**Attribution window:** Current 48h is reasonable for plan starts. Long-horizon signals (plan completion) need a 7–30 day window with explicit delayed attribution.

**Position bias:** In ranked/feed surfaces, reward signals must be de-biased by position. For push notifications, this is less relevant (single message per send), but send order in batched sends can matter.

---

## 5. Contextual Bandits: The Missing Layer

**Yahoo's LinUCB result (Li et al., 2010):**
12.5% click lift over context-free bandit by adding user + item context features. This is the most widely cited benchmark for the value of context.

**Context helps most when:**
- User population is heterogeneous (different users respond to different things)
- Content variants are meaningfully different (not just copy variants of the same message)
- Informative context is available at decision time

**Features that matter most (industry consensus):**
1. Behavioral recency (days since last active session)
2. Session frequency tier (daily / weekly / monthly user)
3. Channel preference (historical open rate by channel)
4. Content category affinity (types of plans completed before)
5. Time of day / day of week at send time
6. Device platform (iOS vs Android engagement patterns differ)

**LinUCB mechanics:**
Assumes linear relationship between feature vector and expected reward per arm. Maintains per-arm parameter vectors + uncertainty matrices. Computationally cheap.

**Nexus migration path (low disruption):**
1. Add 3–5 contextual features to User model
2. Stratify PersonaArmStats by `recency_bucket × persona × channel` (3-dimensional key)
3. Eventually: full LinUCB or neural contextual bandit

The stratified arm stats approach approximates a contextual bandit without the LinUCB formalism.

---

## 6. Non-Stationarity and Temporal Decay

**Types of drift:**
- **Covariate shift:** P(X) changes, P(Y|X) stable — e.g., seasonal user mix changes
- **Concept drift:** P(Y|X) changes — e.g., a message format that used to work stops working because users adapted
- **Label shift:** P(Y) changes — e.g., overall plan start rate drops in summer

**Degenerate feedback loop:**
The system makes decisions → users respond → responses retrain the model → model amplifies initial biases. An arm that gets more sends gets more conversions (exposure effect), gets higher alpha, gets more sends. Can lock in a "winner" that's only winning due to volume.

**Solutions observed in industry:**
- **TikTok:** inject random traffic (5–10%) to new/underexposed content to prevent local optima
- **Schibsted:** add 5% random items to prevent exploitation trap
- **Sliding window:** only count events within the last N days in arm statistics
- **Exponential decay:** multiply (alpha-1) and (beta-1) by δ < 1.0 per update (~0.99 = 90% weight on last 100 days)
- **Periodic reset:** re-initialize arm stats quarterly, warm-start from recent data

**Huyen Chip finding:**
Most companies handle drift with simple retraining (not sophisticated domain adaptation). ~80% of detected drifts are caused by internal data/pipeline bugs rather than genuine concept drift.

**Nexus gap:** No decay mechanism. PersonaArmStats accumulates forever. New variants compete at `Beta(1,1)` against established arms at `Beta(500, 100)`.

---

## 7. Cold Start

**Three distinct cold-start problems:**
1. **New user** — no behavioral history, no persona assignment
2. **New arm (message variant)** — no alpha/beta data; competes against established arms
3. **New agent** — no arm stats at all for any persona

**New user handling (good defaults):**
- Fall back to largest active persona (by cluster size)
- Or assign to "average" persona via uniform feature vector

**New arm problem:**
- `Beta(1,1)` gets explored, but faces arms at `Beta(200, 50)` — the new arm's sampling distribution rarely beats the established arm
- Fix: forced exploration period — force N% of sends to new variants for K days regardless of arm stats
- Twitter: extended warm-up (500 vs 100 epochs) measurably improved test performance

**New agent warm-start (DoorDash hierarchical approach):**
1. Start all arms at calibrated prior `Beta(1, ~30)`
2. Use any available cross-agent data (similar agents, same persona) to warm-start
3. Personalize as data accumulates

---

## 8. Message Timing and Frequency

**Send time optimization:**
- Klaviyo: test across 24h window, narrow to 4h optimal window, maintain ±2h testing band
- YouVersion use case: Bible/devotional behavior clusters heavily at early morning (5–8am) and evening (8–10pm) in user's local timezone
- Per-user `preferredSendHour` can be inferred from historical app session timestamps

**Frequency effects (industry data):**
- 1–4 push per week: optimal engagement zone for lifestyle/media apps
- 5–7 per week: 15–25% higher opt-out rates
- Daily+: 3x opt-out rates vs weekly cadence
- **Asymmetry:** frequency damage (opt-outs) is permanent; frequency gain is temporary. Err conservative.

**Smart suppression:**
- Current Nexus approach: suppress when `avgReward / totalDecisions < -threshold`
- Research suggests **recency-weighted suppression**: a user with a bad lifetime average but recent positive signal should not be suppressed
- Better: suppress based on trailing 90-day reward trend, not all-time average

---

## 9. Offline Evaluation

**The problem:** You can't run a live A/B test to compare the bandit against a static policy without running an inferior policy on real users.

**Inverse Propensity Scoring (IPS):**
From Joachims et al.: when data was collected under a different policy (e.g., random traffic, or an old bandit), you can estimate a new policy's reward by reweighting observations by the probability they were shown under the logging policy. This gives an unbiased off-policy estimate.

**Practical approach for Nexus:**
- The `explore=true` decisions (flagged in TS output) are quasi-random sends
- Use only `explore=true` UserDecision records to estimate the counterfactual reward of any proposed policy change
- This enables pre-production evaluation of algorithm changes without live exposure

---

## 10. Industry Case Studies

| Company | Approach | Result | Relevance |
|---|---|---|---|
| Yahoo | LinUCB contextual bandit for news | +12.5% clicks over context-free | Validates contextual features |
| Deezer | k-means clusters + separate TS per cluster | Cluster approach > individual bandits | Validates Nexus persona architecture |
| DoorDash | Hierarchical Beta warm-start | Quality recommendations from day one | Validates warm-starting strategy |
| Stitch Fix | TS + separate LTV reward services | Faster convergence than ε-greedy | Validates TS choice, reward separation |
| Spotify | ε-greedy + embedding pre-filter | Simplest production-viable approach | Propensity scoring; simpler than Nexus |
| Meta (2014) | Feature-engineered logistic regression | Historical features > algorithm complexity | Feature quality is #1 lever |
| Microsoft/MSN | Contextual bandit decision service | 25–30% CTR lift, 18% revenue lift | Validates contextual bandits at scale |
| TikTok | Random traffic injection | Prevents feedback loop lock-in | Validates forced exploration |

---

## 11. Prioritized Recommendations for Nexus

### Tier 1 — Now (1-line fixes, high impact)

1. **Fix Beta initialization:** Change `initialAlpha=1, initialBeta=1` to `initialAlpha=1, initialBeta=~30` based on actual conversion rate data. Reduces noisy warm-up.

2. **Add temporal decay to arm updates:** On each `PersonaArmStats` update, apply `alpha = 1 + (alpha-1)*0.99`, `beta = 1 + (beta-1)*0.99`. Prevents old data from locking in winners.

3. **Add push-opt-out as negative reward:** Feed push disabled events from Hightouch as `-2.0` reward. Immediately penalizes over-messaging.

4. **Arm update health alert:** Alert if no `PersonaArmStats` rows updated in >24h per active agent. Silent reward loop failure is a real risk.

### Tier 2 — Short Term

5. **Forced exploration for new variants:** When a `MessageVariant` is created, force ≥10% of sends to that variant for 7 days regardless of arm stats.

6. **Multi-signal reward function:** Add `plan_read_day_3` (+0.8) and `plan_completed` (+1.5) to reward calculator alongside `plan_started` (+1.0).

7. **Per-user preferred send hour:** Add `preferredSendHour` to User model, populated from Hightouch session data. Respect in `select-and-send` batching.

8. **Tune persona count:** Target 50–100 active personas. Track feedback rate per persona (conversions/sends/week) — each should see ≥50 conversions/week for stable learning.

### Tier 3 — Medium Term (Highest ceiling)

9. **Contextual features at decision time:** Add `recency_days`, `preferred_channel`, `local_hour`, `content_affinity` to `decideForUser` input. Stratify arm stats by `recency_bucket × persona`. Expected: 10–20% lift based on Yahoo benchmark.

10. **Composite long-term reward:** Weight rewards by user's historical 30-day retention. High-LTV users' conversions worth more; prevents optimizing toward easy-convert churn-prone users.

11. **Offline policy evaluation:** Use `explore=true` UserDecision records as IPS dataset to evaluate algorithm changes before live deployment.

---

## Sources

- Li, L. et al. (2010). "A Contextual-Bandit Approach to Personalized News Article Recommendation." Yahoo Research. [12.5% click lift from LinUCB]
- Eugene Yan (2023). "Explore-Exploit in Bandits." [Production survey: Deezer, Yahoo, DoorDash, Stitch Fix, Spotify, Twitter, Alibaba]
- Stitch Fix Engineering (2020). "Multi-Armed Bandits for Dynamic Pricing." [Architecture patterns, reward services, TS vs ε-greedy]
- Lilian Weng (2018). "The Multi-Armed Bandit Problem and Its Solutions." [Algorithm theory, regret bounds]
- Huyen Chip (2022). "Data Distribution Shifts and Monitoring." [Non-stationarity, feedback loops, concept drift]
- Hugging Face RLHF Blog (2022). "Illustrating RLHF." [Reward hacking, Goodhart's Law, KL penalties]
- Meta (2014). "Practical Lessons from Predicting Clicks on Ads at Facebook." [Feature importance > algorithm complexity]
- Joachims et al. (2017). "Unbiased Learning to Rank with Unbiased Propensity Training." [Counterfactual evaluation, IPS]
- Microsoft Decision Service (2016). [25–30% CTR lift, 18% revenue lift from contextual bandits]
- Optimizely. "Multi-Armed Bandit vs A/B Testing." [1–5% vs 5–15% conversion loss during test period]
- TensorFlow Agents Bandit Tutorial. [LinUCB implementation reference]
