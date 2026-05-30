# Agent Training, Multi-Dimensional Credit Assignment & Convergence Visibility

> Design notes from the 2026-05-30 architecture discussion. Two linked problems:
> (1) how agents learn the *right value per dimension* per user, and (2) how we
> surface "is this agent learning / how confident is it" on the agent card.
> This is a thinking document to work from — not a finalized spec.

---

## Part 1 — Multi-dimensional credit assignment

The campaign dimensions we want agents to personalize per user:

| Dimension | Example values |
|-----------|----------------|
| Goal | Encourage churned customers to resubscribe |
| Success metric | Incremental NPV per customer |
| Frequency | how often |
| Send day of week | Mon–Sun |
| Send time | morning / midday / evening / night |
| Offer | discount tiers, etc. |
| Creative | message variants |
| Channel | email, SMS, push |

### The core truth

**For a single send you cannot know which dimension caused the outcome.** One
success is one data point that nudges *every* choice you made up a little.
Credit assignment across dimensions is only solvable **statistically, across many
sends**, by a model that takes each dimension as an input AND by varying those
dimensions independently enough that their effects aren't confounded.

So the design question is not "which aspect worked on this push" — it's "what
structure lets the system isolate each dimension's marginal contribution over
time."

### The trap: don't make every combination an arm

Full factorial (3 freq × 7 day × 4 time × 4 offer × 5 creative × 2 channel) ≈
**6,700 combinations**. As bandit arms that's combinatorial death — a winback
campaign gives ~1–5 touches per churned user. We never get enough pulls per arm.
The whole game is **decomposing credit, not enumerating combinations.**

Two decomposition strategies (tradeoff):

- **Factored bandits** — one independent bandit per dimension. Cheap, fast, each
  dimension updates its own chosen option toward observed reward. Blind to
  interactions (a bold creative that wins on SMS but flops in email gets
  averaged into mush).
- **Contextual / linear model** (this is what LinUCB already is). Encode the
  *action itself* as features — one-hot channel, time bucket, creative id, offer
  id — alongside user context. The learned coefficients (θ) **are** the credit
  assignment: each dimension's marginal effect, plus a few explicit interaction
  terms for cross-effects we actually believe in. Needs more data; answers
  "which aspect works" directly.

**Recommendation:** extend the contextual approach we already have rather than
spin up six independent bandits.

### Don't treat all six dimensions with the same mechanism (biggest leverage)

- **Creative + Offer** → true bandit arms. What TS / LinUCB is built for. Keep as
  the thing we "pull."
- **Send time + Day of week** → *don't bandit these.* We already compute
  morning/evening/weekend engagement ratios in `feature-vector.ts`. A per-user
  timing predictor from the user's own engagement history beats cold bandit
  exploration. Best-time-to-reach is a property of the user, not a lever to
  explore from scratch.
- **Channel** → partly an eligibility constraint already
  (`newsletter_push_enabled` / `newsletter_email_enabled`), partly a contextual
  feature. Let the model learn channel effect, but gate on consent.
- **Frequency** → **not a reward-maximizing arm.** Over-sending has *negative*
  long-horizon NPV (unsubscribe, fatigue) that a short-horizon open/click reward
  never sees. Model as a fatigue-aware cap optimized against the
  unsubscribe/NPV signal. A fast-reward bandit picking frequency learns "send
  more" and torches churn.

### The reward signal is the hidden hard problem

Success metric = **incremental NPV per customer** — long-horizon, delayed,
sparse, continuous. Totally different from "push opened." Need a **two-tier
reward**:

- **Fast proxy** (open / click) for quick credit + exploration steering.
- **True reward** (resubscribe → NPV) that lands days/weeks later.

Implications:
- Must persist the **full action vector** (every dimension chosen) in
  `decisionContext` at send time, so when NPV arrives we attribute it back to the
  exact combination. (We already store `decisionContext`.)
- "Incremental" implies a **control / holdout** so we measure lift, not
  correlation with people who'd have resubscribed anyway.

### Exploration must be structured or attribution is confounded

If we always co-vary dimensions (new creative always at the new time on the new
channel), the model can't separate them. To get clean credit, **randomize
dimensions independently** during exploration — a continuously-running
fractional factorial. That independent variation is *what makes each
dimension's marginal effect estimable.* Most common reason these systems learn
garbage.

### Systematic "what do I adjust on failure" loop

Diagnose at the dimension level, never per-failed-push:

1. Per-dimension marginal-reward dashboards, **segmented by persona**: reward by
   time bucket, by creative, by channel.
2. The dimension worth adjusting = **large (best − worst) spread AND current pick
   far from best.** Big spread + picking wrong = high-value fix. Small spread =
   stop optimizing it.
3. Off-policy / counterfactual evaluation on logged data to estimate a different
   policy's reward without sending anything.

### Concrete plan for Nexus

1. Keep **creative/offer** as bandit arms (what we have).
2. Feed **channel + time-bucket + day** into LinUCB as *context features* so the
   linear model learns their effects and key interactions — θ becomes the
   credit-assignment readout.
3. Move **send time/day** to a per-user timing model off the engagement-ratio
   features already in `feature-vector.ts`.
4. Treat **frequency** as a fatigue cap tied to long-horizon unsubscribe/NPV, not
   per-send reward.
5. Randomize contextual dimensions independently during exploration.
6. Persist the full action vector in `decisionContext`; reconcile NPV/resubscribe
   back to it against a holdout.

**Start by nailing the reward definition (proxy vs NPV + the holdout)** — every
other decision hangs off it.

---

## Part 2 — Convergence / training visibility on the agent card

### Reframe: convergence is NOT a finish line

A healthy contextual bandit in a drifting world (new creatives, seasonality,
churned users whose tastes move) **should never fully converge** — it must keep
exploring. A "100% converged" progress bar invites people to turn off
exploration, which kills adaptation. Frame the user-facing concept as
**learning confidence + learning health**, not a march to a finish line.

Two distinct questions the card should answer (people conflate them):

1. **"Has the agent found a confident winner yet?"** (confidence)
2. **"Is the learning loop actually working?"** (health) — separate, and more
   operationally important.

### The honest scalar: P(best)

We already store per-persona Beta `α/β`. The most principled convergence number
falls out of it:

> **P(best)** = probability the current leading arm is truly the best, via Monte
> Carlo — draw K samples from each arm's Beta(α,β), count the fraction of draws
> where the leader wins.

When `max_i P(best_i)` climbs past ~95% and *stays* there, we've genuinely
converged on a winner. Beats a hand-rolled heuristic: accounts for both
separation (means apart) and certainty (posteriors tight). Cheap, computable
from data we already have. (See existing `src/lib/convergence.ts` — audit
whether it's this or a heuristic.)

### Discrete states beat a fake percentage

A small state machine is more honest than a precise % for low-volume winback
agents:

- **Cold / Warming up** — arms under min pulls (`warmupUntil`). Don't pretend.
- **Exploring** — enough data, posteriors overlap, P(best) low.
- **Converging** — a leader emerging, P(best) climbing, leader stable.
- **Confident** — P(best) past threshold + leader stable over time. (Still
  explores a little — not "done.")
- **Drifting / Re-learning** — was confident; leader changed or reward dropped →
  world shifted.

**Card shows:** state label + P(best) number + a tiny sparkline of P(best) over
time (trending up, or thrashing?).

**Detail page shows the richness:** per-arm posterior means with credible
intervals (the "are the bars separating" view — most intuitive), leader-stability
timeline, cumulative-reward-vs-baseline curve whose *flattening slope* signals
diminishing returns from exploration.

### Caveats that will bite us (design in now)

- **Convergence is per-persona, not per-agent.** `PersonaArmStats` is segmented
  by persona — an agent can be Confident for persona A and Cold for persona C.
  Card number must aggregate **weighted by traffic**; detail page breaks it out,
  or a high-volume persona masks three cold ones.
- **A broken reward pipeline looks identical to "slow to converge."** If rewards
  stop flowing, the agent sits in "Exploring" forever looking merely patient.
  Surface **"last reward received N days ago"** as a health flag — highest-value
  signal on the card, near-zero cost.
- **Which reward is convergence measured on?** The fast proxy (opens) looks
  converged long before the true NPV model is warm. Be explicit. Card shows
  proxy-convergence; detail shows proxy + outcome side by side (they diverge).
- **Non-stationarity vs frozen Beta stats.** Accumulate α/β forever → old data
  dominates → agent gets "stuck converged" and the badge lies after the world
  changes. Convergence visibility stays truthful only with decay / sliding
  window so "Confident" can fall back to "Drifting."
- **Multi-dimensional = convergence is per-dimension.** Once contextual
  dimensions land, "convergence" splits: creative may be Confident while channel
  is still Exploring. Card stays a single rolled-up state; detail page shows the
  per-dimension grid.

### Where to start

We already call `getCachedAgentConvergenceStates()` and pass `convergenceStates`
into the agent grid — there's an existing notion. First move: read how it's
computed today, decide if it's principled P(best) or a heuristic, then layer in
the **reward-health flag (last-reward-age)** — cheap and high-value. The P(best)
scalar + state machine + health flag can ship independent of the
multi-dimensional work; hold the per-dimension view until the reward definition
is settled.
