# Synthesis: OfferFit "A Community of Bandits" × YouVersion Internal Data
*Compiled April 2026 — cross-reference of OfferFit architecture paper, internal Braze benchmarks, and external engagement research*

---

## 1. What the Paper Argues

OfferFit's "Community of Bandits" (CoBandits) paper proposes that a single bandit model is too rigid across the full customer population. Their key insight: **different users are best served by different oracle types**. They build a team of four oracle types per decision dimension and use a meta-bandit to route each user to the best oracle:

| Oracle | Model | Best for |
|--------|-------|----------|
| O1 | Multi-Armed Bandit (Thompson / UCB) | Cold users — zero/few interactions, no signal |
| O2 | Linear model (Elastic Net) | Moderate data — linear feature-reward relationship |
| O3 | Simple GBDT | Rich data — non-linear patterns, moderate complexity |
| O4 | Complex GBDT (XGBoost/LightGBM) | Power users — high data density, complex interactions |

The meta-bandit's job is not to pick the best arm, but to pick the best **oracle** for each user based on their data richness. This is the bias-variance tradeoff made explicit in the system architecture.

### Dimension Decomposition

Rather than treating the full cross-product of {channel × content × time × frequency} as one action space (which grows exponentially), CoBandits decomposes decisions into sequential dimensions with chaining:

```
Channel → Content/Offer → Send Time → Frequency
```

Each dimension is decided by its own oracle community. The channel decision becomes part of the context for the content decision, etc. This reduces sample complexity from O(C×N×T×F) to O(C + N + T + F), enabling much faster convergence.

### Action Features

Rather than treating variant IDs as opaque arms, CoBandits describes variants by feature vectors (tone, personalization level, CTA type, length). This enables **generalization across variants**: a new variant with high personalization and empathy tone inherits signal from other high-personalization variants without needing its own exploration warm-up. This is the key unlock for cold-start on new content.

---

## 2. Where Nexus Stands Today vs. CoBandits Architecture

| Dimension | CoBandits | Nexus Today |
|-----------|-----------|-------------|
| Oracle type | 4-oracle community per dimension | Single oracle (Thompson or EpsilonGreedy) |
| Oracle selection | Meta-bandit per user × dimension | Fixed per agent |
| Context features | Rich feature vector at select-time | Beta(1,30) arms only; no context |
| Dimension decomposition | Channel → Content → Time → Freq | Single decision covers all |
| Action features | Variant described by semantic features | `actionFeatures Json?` added (new) |
| Personas | Optional (warm start) | Per-persona arm stats (core segmentation) |
| Send time | Separate dimension oracle | `recommendedSendHour` from hourlyStats (new) |

**Nexus has just implemented the first contextual layer (LinUCB) and the action/context feature infrastructure.** The next evolutionary step is adding the oracle progression logic (auto-switch oracle as user data accumulates) and dimension chaining.

---

## 3. YouVersion Gap Analysis vs. Industry Benchmarks

### Push Notifications

| Segment | Internal CTR | Industry Best (Airship 2026) | Gap |
|---------|-------------|-------------------------------|-----|
| DEU | 2.45% | 8–14% (triggered, segmented) | 3–6× |
| New User | 2.41% | 8–14% | 3–6× |
| DAU | 1.22% | 8–14% | 7–11× |
| MAU | 0.66% | 8–14% | 12–21× |
| Lapsed | 0.32% | 8–14% | 25–44× |

**Root cause analysis:** YouVersion sends broadcast pushes; industry benchmark is triggered+segmented. The 3–6× gap for high-engagement users (DEU) is achievable through better content selection. The 25–44× gap for lapsed users is partly structural — even perfect content can't close that gap without trigger timing.

### Email

| Signal | Internal | Faith Org Industry |
|--------|----------|--------------------|
| CTOR (personalized subject) | 1.25% | 8–10% |
| Open rate (nurture) | ~42% | 44–60% |
| Open rate (broadcast) | ~6% | 44–60% |

**Root cause:** Body content and CTAs are generic. The subject-line personalization test ("+4× vs baseline") shows personalization works — it just hasn't been extended to body/CTA.

### IAM

| Event type | CTR | Industry modal benchmark |
|-----------|-----|--------------------------|
| Regular giving | 0.52–0.85% | 11–13% |
| Easter / liturgical | 10.9–22.5% | 11–13% |

**Root cause:** Timing is the primary lever. Liturgical events can hit industry-par performance; routine giving cannot. The implication: Nexus should learn the temporal patterns that predict liturgical receptivity (streak depth, recency, plan engagement) and weight those heavily for giving campaigns.

---

## 4. Top 5 Actionable Opportunities (Ranked by Expected Impact)

### 1. Streak-Break Canvas (Highest-CTR Untapped Trigger)
- **Industry benchmark:** ~7.4% CTR for habit-reinforcement triggered messages (Airship 2026)
- **Signal:** `plan_day_current_month_count` drop + `days_since_last_open` increase
- **Reward:** `plan_daycomplete` within 48h (already in reward-calculator)
- **How Nexus enables this:** Pass `streak_status: "at_risk"` or `"broken"` in `context` at decide-time. Use `giver_tier` and `plan_depth` feature dims [37, 40] to personalize message tone.
- **Expected lift:** Moving from current lapsed CTR (0.32%) toward ~5–7% for at-risk/recent users

### 2. Email Body/CTA Personalization (CTOR Gap: 8× industry)
- The subject-line test proved personalization works (+4×). The same treatment applied to body content and CTAs would close the CTOR gap.
- **How Nexus enables this:** `actionFeatures.hasPersonalization: true` variants. LinUCB's action feature generalization means new personalized variants immediately inherit CTR signal from existing personalized variants.
- **Mechanism:** `tone: "question"` + `hasPersonalization: true` + `ctaType: "deeplink"` features in `actionFeatures` let the oracle learn "personalized question + deeplink → higher CTOR" as a generalizable rule.

### 3. Send-Time Optimization Using App Feature Usage Curve
- Braze Intelligent Timing only uses communication engagement data (when the user responds to messages). It knows nothing about when the user opens the app, reads the Bible, prays, or finishes a plan.
- **Nexus advantage:** `hourlyStats` tracks app-feature engagement by hour. `recommendedSendHour` in `DecideResult` is the peak app-activity hour — not the peak message-click hour. For spiritually-engaged users, app activity predicts receptivity better than comms history.
- **Research backing:** OptinMonster/Mailchimp research shows email sent within ±2h of peak user activity achieves 15–25% higher open rates. Braze Intelligent Timing gets ~40% lift over broadcast timing (their own data); app-feature timing should exceed this for MAU/engaged users.
- **Calibration needed:** At low data volumes, fall back to demographic defaults (8am and 7pm for YouVersion's US-heavy base). The `hourlyStats` signal needs ≥10 data points before trusting it.

### 4. Giving Segmentation (New vs. Lapsed Givers)
- `giving_tier` (sower/giver/non-giver) is now in the feature vector at dim [37].
- Sowers are the highest-value segment ($370/giver for push in Apr 2026 data).
- **Mechanism:** `weightMode: "property"` in Goal config (already implemented in reward-calculator) lets giving agents weight rewards by transaction amount. Configure a separate "Lapsed Giver" agent with `giver_tier: "giver"` targeting and higher urgency tone variants.
- **Expected approach:** Content Card ($741K/week, 0.0091% CVR) + targeted lapsed-giver push ($458K, $370/giver) optimized via Nexus will outperform the current broadcast approach.

### 5. Oracle Progression (CoBandits O1→O4 Auto-Escalation)
- Currently Nexus always uses the same algorithm (Thompson or EpsilonGreedy) regardless of user data richness.
- **CoBandits finding:** Oracle complexity should match data richness. Cold users → MAB. Moderate users (20–100 decisions) → LinUCB. Rich users (100+ decisions) → GBDT.
- **Implementation path:** The LinUCB oracle added in this sprint is the O2 layer. The meta-bandit switching logic (move user from Thompson → LinUCB when `totalDecisions >= 20`) is the next piece. This can be implemented as a helper in `decide.ts` without new DB models.

---

## 5. Architectural Recommendations for Nexus

### Near-term (this sprint — already implemented)

- ✅ **Semantic feature vector expansion** (44 dims: 37 behavioral + 7 semantic) — enables persona clustering on spiritual engagement depth, not just comms behavior
- ✅ **Decision context capture** (`decisionContext` JSON on `UserDecision`) — essential for offline policy evaluation and oracle training
- ✅ **Action features** (`actionFeatures` JSON on `MessageVariant`) — enables variant generalization across tone/personalization/CTA axes
- ✅ **LinUCB oracle** — linear contextual bandit using user feature vector; the first step toward the OfferFit O2 oracle
- ✅ **Send-time recommendation** (`recommendedSendHour` in `DecideResult`) — caller (cron/Braze) can use this to schedule at optimal time

### Next sprint

- **Meta-oracle switching:** In `decideForUser`, auto-select algorithm based on `user.totalDecisions`:
  - `< 20` → Thompson Sampling (O1: MAB)
  - `20–99` → LinUCB (O2: linear contextual)
  - `≥ 100` → Thompson Sampling with tighter priors (until GBDT oracle is built)
- **Streak-break canvas trigger:** Add `/api/decide` support for `trigger_event: "streak_break"` → reward function emphasizes `plan_daycomplete`; messaging tone weighted toward "empathy" variants
- **LinUCB arm update endpoint:** Add `/api/ingest/events` handling for `linucb_arm_update` event type to call `LinUCB.update()` on reward signal

### Medium-term (Phase 2)

- **Dimension chaining:** Separate agents for channel-selection vs. content-selection, with channel decision passed as context to content agent
- **GBDT oracle (O3/O4):** For power users with 100+ decisions, a simple GBDT trained on (feature_vector × action_features → reward) will outperform LinUCB's linear assumption
- **Offline policy evaluation:** Use `decisionContext` + `reward` in `UserDecision` table as the training dataset for batch oracle retraining

---

## 6. Key Principles from the Paper (Applied to Nexus)

**"The right model for the right user, not one model for everyone."**
YouVersion has a 13× range in engagement rates between DEU and lapsed users. One bandit model cannot efficiently serve both. The persona-segmented arm stats partially address this; oracle progression will complete the picture.

**"Cold variants need warm priors, not cold starts."**
Action features (`actionFeatures` JSON) let new message variants inherit signal from variants with similar tone/personalization profiles. A new "streak empathy + deeplink" variant needs only a few trials to converge because the oracle has already learned that profile converts.

**"Temporal alignment is the single highest-ROI intervention."**
Liturgical timing produced 10–26× CTR lift. App-usage hourly curves are the best proxy for receptivity for non-liturgical sends. This is the one place Nexus's data advantage (app behavior, not comms behavior) most clearly exceeds Braze Intelligent Timing.

**"Frequency budget is finite — spend it on the right users."**
WAU resurrection (0.6% relative lift vs control) is burning frequency budget. Lapsed users respond weakly to push regardless of content. Nexus's smart suppression + frequency cap logic should be tuned to redirect that budget to at-risk-streak users (7.4% industry CTR) and liturgical windows.

---

---

## 6b. Deep Research Supplement — Academic Findings (April 2026)

*Consolidated from a parallel deep-dive across Braze engineering docs, arXiv, and production system case studies.*

### Braze AI ("BrazeAI™") — Confirmed Architecture

Braze Intelligent Timing:
- Uses **historical comms engagement only** (notification opens, email clicks, session starts) — NOT app feature events (plan completions, prayer sessions, Scripture reads)
- Requires minimum data threshold before personalizing; cold-start fallback = population-level "most popular time" (not personalized)
- **This is the confirmed gap Nexus exploits:** `hourlyStats` tracks app-feature engagement by hour of day, not just when the user taps a notification

Braze Intelligent Selection:
- Confirmed Thompson Sampling with Beta priors
- Population-level (finds globally best variant); NOT contextual at individual level
- Requires ≥50 sends per variant before meaningfully shifting allocation — significant cold-start cost
- No cross-campaign learning; each campaign's bandit is isolated

**Bottom line:** Nexus is already architecturally ahead — persona-segmented Thompson Sampling is a form of contextual bandit. The next leap is using app-behavioral send-time + oracle progression.

### Empirical Bayes Multi-Bandit (ebmTS) — Cross-Agent Learning

Paper: arXiv:2510.26284. The most relevant academic work for scaling Nexus across many agents.

Architecture:
- Each bandit maintains its own per-arm posterior (as Nexus does today)
- A **hierarchical prior** learns the covariance structure between agents — how similar are reward rates across agents sharing the same (persona, channel)?
- New agents inherit this global prior and converge to their own posterior as data accumulates

**Nexus implementation path:** Add a `PersonaChannelPrior` table with `(personaId, channel, globalAlpha, globalBeta, agentCount)` updated periodically from the mean of all active agents. New agents initialize `PersonaArmStats` from this prior instead of the flat Beta(1,30). This would shrink cold-start from ~50 decisions/arm to ~5-10.

### JITAI Research — Behavioral Send-Time (Confirming §5)

HeartSteps V2 (arXiv:1909.03539, mobile health RL): Intervention timing conditioned on **current user state** (location, activity, recent behavior) consistently outperforms history-of-comms-engagement timing. The key state variable is "time since last in-app feature completion" — not "time since last notification open."

PEARL Study (arXiv:2508.10060): 13,463-user RCT. RL-optimized send timing → +296 steps/day vs. fixed schedule at 1 month. Effect sustained at 2 months (+208 steps). This is the academic proof that behavioral send-time is a real effect at scale.

**Implication for `recommendedSendHour`:** The current implementation picks the peak hour from `hourlyStats` (app usage). The next level is a simple regression model: `P(app_open in next 2h | time_since_last_session, typical_session_hour, day_of_week)`. Send when this probability peaks, not just when historical usage peaked.

### Reward Design — Tiered Delayed Schedule + IPS

**Tiered reward schedule (recommended):**
```
+0.10  — message open (0–1h)
+0.30  — click-through / deeplink (0–1h)
+1.00  — plan completion (1–24h)    [primary engagement objective]
+5.00  — first giving event (1–31d) [revenue objective]
+0.50  — giving event (recurring giver, 1–31d)
```

**Partial credit at open time:** A user who opens within 5 minutes is ~3× more likely to complete a plan in 24h. Assign `expected_reward = P(completion|open) × 1.0 = 0.35` at open time; correct when outcome resolves. This reduces the effective reward delay from 24h → near-real-time.

**IPS counterfactual correction:** Record arm selection probability `π(a|x)` at decide-time. At reward receipt: `reward_update = observed_reward / π(a|x)`. Clip IPS weights at 10× to control variance. This makes bandit experiment results valid for reporting without a separate A/B holdout.

**Multi-objective scalarization (CMAB-DO, arXiv:1708.05655):** For giving campaigns, primary objective = sustained engagement (plan completion over 30 days), secondary = giving conversion. Arms that reduce engagement to maximize short-term giving are penalized. Starting weights: `w_engagement=1.0, w_giving=10.0, w_open=0.3` — adjust based on LTV analysis.

### A/B vs. Bandit — Decision Framework

| Use A/B when | Use Bandit when |
|---|---|
| Validating a new message category or channel | Optimizing within a proven category |
| Need clean causal estimate for business decision | Traffic is limited, exploration cost is high |
| ≤3 variants, ≤2 week run, adequate N | Reward rates expected to drift (seasonal, freshness) |
| Guardrail metric evaluation required | "Always-on" optimization, no manual launches |

**Valid inference from bandit traffic:** Standard t-tests are biased by adaptive allocation. Use **e-values or mixture martingale tests** (always-valid inference) to get valid p-values at any stopping point without waiting for a fixed experiment end. This is compatible with Thompson Sampling traffic.

### Key Paper References

| Topic | arXiv | Finding |
|---|---|---|
| Multi-bandit hierarchical prior | 2510.26284 (ebmTS) | Learn covariance across agents; empirical Bayes warm-start |
| Multi-task representation | 2410.02068 | Shared low-rank feature representation; O(r) not O(d) sample complexity |
| Hierarchical warm-start from logs | 2212.04720 (HierOPO) | Off-policy learning across related agents from logged decisions |
| JITAI behavioral timing | 1909.03539 (HeartSteps V2) | State-conditioned timing >> comms-history timing |
| JITAI at scale | 2508.10060 (PEARL) | +296 steps/day in 13,463-user RCT |
| Multi-objective bandit | 1708.05655 (CMAB-DO) | Primary + secondary objective; prevents engagement harm |
| Delayed feedback | 2202.00846 | Estimate objective before materialization; partial credit at open |
| LinUCB | 1003.0146 (Li et al.) | 12.5% CTR lift over context-free; foundational contextual bandit |
| Thompson Sampling vs. UCB | 1707.02038 (Russo et al.) | TS beats UCB with feedback delays >10-30 min |
| A/B optimality | 2308.12000 (ICML 2024) | Uniform sampling is universally optimal for 2-arm; bandits win for >2 |

---

## 7. Data Quality Notes

- `days_since_last_open` is a Hightouch-synced attribute. If Hightouch sync is delayed or the field is not present, `vec[39]` (recency score) defaults to 0 rather than assuming recency — this is intentional conservative behavior.
- `giving_tier` values are lowercased before comparison (`"sower"`, `"giver"`). Ensure Hightouch sync normalizes this field.
- `plan_day_current_month_count` resets monthly; it measures current-month streak depth, not lifetime streak. For lifetime streak tracking, `plan_finish_lifetime_count` (dim [40]) is the better proxy.
- LinUCB `aInv` matrices (44×44 = 1936 floats per arm) are ~15KB per row in `LinUCBArm`. For agents with many variants across many personas, monitor table growth. At 10 variants × 10 personas = 100 rows = 1.5MB — well within Neon limits.
