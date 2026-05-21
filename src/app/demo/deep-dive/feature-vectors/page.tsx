export default function FeatureVectorsPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold mb-1">Feature Vectors</h1>
      <p className="text-muted-foreground text-sm mb-6">
        How 10 behavioral and semantic signals are bucketed into a compact
        vector representing a user&apos;s engagement profile.
      </p>

      <p className="text-sm leading-relaxed">
        Every user in Nexus is represented as a point in a 10-dimensional
        vector space. This representation — the feature vector — serves two
        purposes. First, it provides the input to k-means++ persona clustering:
        users whose vectors are nearby (under cosine distance) are grouped into
        the same behavioral archetype. Second, it supplies the context variable{" "}
        <span className="font-mono text-xs">x</span> consumed by the LinUCB
        contextual bandit, which conditions arm selection on the user&apos;s
        current behavioral profile rather than only their persona membership.
      </p>
      <p className="text-sm leading-relaxed">
        The 10 dimensions fall into two bands: behavioral dimensions [0–5]
        derived from Nexus decision and conversion logs, and semantic dimensions
        [6–9] synced from Braze custom attributes via Hightouch and encoding
        YouVersion-specific engagement depth. Every dimension is normalized to
        approximately [0, 1] so that cosine similarity is not dominated by a
        single high-magnitude signal.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <p className="text-sm">
          <strong>Why 10 dimensions?</strong> The prior implementation used 44
          dimensions — a 24-bin hourly histogram plus a 7-bin day-of-week
          histogram plus 13 scalar signals. Those 31 histogram bins were heavily
          correlated and dominated cosine distance. Manual bucketing collapses
          them into 5 interpretable ratio signals (morning, evening, weekend,
          plus channel rates) while preserving the same information. The result
          is a denser, more interpretable vector with better k-means++ convergence
          and cleaner arm separation in LinUCB.
        </p>
      </div>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Behavioral Dimensions [0–5]
      </h2>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [0] Push Conversion Rate &amp; [1] Email Conversion Rate
      </h3>
      <p className="text-sm leading-relaxed">
        The first two dimensions encode per-channel conversion rates for push
        notifications and email respectively:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[0] = push.converted / push.sent{"\n"}
        vec[1] = email.converted / email.sent
      </div>
      <p className="text-sm leading-relaxed">
        These are intentionally <em>not</em> normalized relative to one another.
        Absolute channel preference matters: a user who converts on 40% of push
        messages and 2% of emails is meaningfully different from one with 15%
        push and 14% email, even though both might look similar under
        cross-channel normalization. Division by zero is guarded: if{" "}
        <span className="font-mono text-xs">sent = 0</span> for a channel, that
        dimension is set to 0.0.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [2] Morning Ratio, [3] Evening Ratio, [4] Weekend Ratio
      </h3>
      <p className="text-sm leading-relaxed">
        Rather than storing a full 24-bin hourly histogram (which would consume
        24 of 44 dimensions in the old layout and be dominated by a few
        high-variance bins), Nexus collapses temporal behavior into three
        interpretable ratio signals:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {`vec[2] = Σ hourly[5..11]  / hourlyTotal   // 5 am–11 am share`}{"\n"}
        {`vec[3] = Σ hourly[17..22] / hourlyTotal   // 5 pm–10 pm share`}{"\n"}
        {`vec[4] = (daily[0] + daily[6]) / dailyTotal  // Sun+Sat share`}
      </div>
      <p className="text-sm leading-relaxed">
        The denominators are the total counts across all bins, making each ratio
        a pure probability: the fraction of a user&apos;s engagement that falls
        in that window. A user with vec[2]=0.72 is a heavy morning engager; one
        with vec[4]=0.60 is weekend-dominant. If a user has no conversion
        history yet (all bins zero), these three dimensions are left at 0.0 and
        handled by the cold-start fallback.
      </p>
      <p className="text-sm leading-relaxed">
        Morning and evening ratios do not sum to 1 — they are independent
        windows, and a user&apos;s remaining activity falls in other hours
        (midday, late night). A user who splits evenly between 9 AM and 7 PM
        will have both ratios around 0.5, while a pure night-owl will have both
        near zero. This asymmetry is intentional: it lets the vector capture
        multi-modal temporal patterns that a single peak-hour scalar would miss.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [5] Overall Conversion Rate
      </h3>
      <p className="text-sm leading-relaxed">
        A single scalar representing aggregate engagement across all channels
        and time periods:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[5] = totalConversions / totalDecisions
      </div>
      <p className="text-sm leading-relaxed">
        This provides a global responsiveness signal not captured by the
        per-channel rates. A user who responds to almost every message across
        all channels will have a high overall rate even if their per-channel
        rates are moderate. Combined with [0] and [1], these three scalars
        encode both per-channel affinity and overall intent level.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Semantic Dimensions [6–9]
      </h2>
      <p className="text-sm leading-relaxed">
        Dimensions 6–9 encode YouVersion-specific engagement depth signals
        synced from Braze custom attributes via Hightouch reverse ETL and stored
        in the <span className="font-mono text-xs">User.attributes</span> JSON
        column. Unlike the behavioral dimensions, these are not derived from
        Nexus decision logs — they represent the user&apos;s broader relationship
        with the YouVersion platform.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [6] Recency Score
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[6] = 1 − min(1, days_since_last_open / 90)
      </div>
      <p className="text-sm leading-relaxed">
        A linear decay from 1.0 (opened today) to 0.0 (inactive 90+ days). The
        90-day threshold matches YouVersion&apos;s definition of a dormant user.
        If <span className="font-mono text-xs">days_since_last_open</span> is
        absent from the attribute payload, the dimension is left at 0.0 rather
        than defaulting to an assumed value — absence of signal is not the same
        as confirmed dormancy.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [7] Giving Tier
      </h3>
      <p className="text-sm leading-relaxed">
        Ordinal encoding of donation behavior:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[7] = 0.0   // no giving history{"\n"}
        vec[7] = 0.5   // giver (has donated){"\n"}
        vec[7] = 1.0   // sower (recurring or high-value donor)
      </div>
      <p className="text-sm leading-relaxed">
        A direct ordinal encoding rather than one-hot because the tiers
        represent a monotonic depth signal. Cosine similarity handles ordinals
        correctly when the underlying assumption — that more giving implies
        deeper financial commitment — holds, which it does empirically in
        YouVersion&apos;s giving data.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [8] Spiritual Depth
      </h3>
      <p className="text-sm leading-relaxed">
        A composite signal averaging five normalized engagement depth measures:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {`streak   = min(1, plan_day_current_month_count / 31)`}{"\n"}
        {`plan     = log(1 + plan_finish_lifetime_count) / log(501)`}{"\n"}
        {`prayer   = min(1, gp_current_month_count / 30)`}{"\n"}
        {`scripture= min(1, gs_current_month_count / 30)`}{"\n"}
        {`badge    = log(1 + badge_lifetime_count) / log(201)`}{"\n\n"}
        {`vec[8]   = (streak + plan + prayer + scripture + badge) / 5`}
      </div>
      <p className="text-sm leading-relaxed">
        Each component is normalized to [0, 1]: streak and prayer/scripture use
        linear caps (31 days, 30 sessions per month); plan depth and badge depth
        use log-scaling with power-user ceilings (500 completions, 200 badges)
        because those distributions are heavy-tailed. The composite mean gives
        each signal equal weight in the absence of evidence that one dominates —
        weighting can be tuned once Alvaro&apos;s PCA/NMF analysis identifies
        which components carry the most variance.
      </p>
      <p className="text-sm leading-relaxed">
        Collapsing five signals into one composite dimension (instead of five
        separate dimensions, as in the 44-dim layout) reflects the empirical
        finding that these signals are highly correlated: a user who prays daily
        also tends to read plans and earn badges. Keeping them separate would
        over-represent this correlated cluster in cosine distance.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [9] Engagement Frequency
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[9] = log(1 + totalDecisions / 4) / log(101)
      </div>
      <p className="text-sm leading-relaxed">
        Log-scaled sends-per-week over an approximate 4-week window, normalized
        so that 100 decisions/week ≈ 1.0. Raw decision counts follow a
        heavy-tailed distribution; storing them raw would make frequency the
        dominant dimension. The{" "}
        <span className="font-mono text-xs">/4</span> converts total decisions
        to a weekly rate; the denominator{" "}
        <span className="font-mono text-xs">log(101)</span> was chosen to match
        the 95th-percentile weekly frequency in the YouVersion user base.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Why Cosine Similarity, Not Euclidean Distance?
      </h2>
      <p className="text-sm leading-relaxed">
        All 10 dimensions are non-negative — rates, log-scaled counts, and
        ratio signals are all ≥ 0. Euclidean distance is magnitude-sensitive: a
        user with 1,000 push sends and a 30% rate would appear very different
        from one with 10 sends and the same 30% rate under L2, even though their
        behavioral profiles are structurally identical. Cosine similarity
        measures the angle between two vectors and is invariant to magnitude:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        cos(u, v) = (u · v) / (‖u‖ · ‖v‖)
      </div>
      <p className="text-sm leading-relaxed">
        Because all dimensions are non-negative, the dot product is always ≥ 0
        and the practical range of cosine similarity is [0, 1]. We define cosine{" "}
        <em>distance</em> as{" "}
        <span className="font-mono text-xs">1 − cos(u, v)</span> ∈ [0, 1],
        which is used throughout k-means++ and persona assignment.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">Cold-Start Users</h2>
      <p className="text-sm leading-relaxed">
        New users have all-zero feature vectors. The cosine similarity formula
        requires at least one non-zero vector —{" "}
        <span className="font-mono text-xs">‖u‖ = 0</span> makes the
        denominator zero and the similarity undefined. Nexus handles this at two
        levels:
      </p>
      <ul className="text-sm leading-relaxed list-disc ml-5 space-y-1">
        <li>
          <strong>Persona assignment:</strong> The cron skips users whose
          feature vector is all-zero; they are not assigned to any persona and
          are not eligible for agent sends that require persona targeting.
        </li>
        <li>
          <strong>Arm selection:</strong> If a user reaches arm selection
          without persona data, Nexus falls back to the global prior{" "}
          <span className="font-mono text-xs">Beta(1, 30)</span> — a
          heavy-exploration prior reflecting no evidence of any arm being
          superior.
        </li>
        <li>
          <strong>Send-time scheduling:</strong> Without temporal ratio data,
          the preferred send hour is undefined. The cron uses the agent&apos;s
          configured <span className="font-mono text-xs">fallbackSendHour</span>{" "}
          (default 09:00 UTC) rather than attempting to infer a peak-hour.
        </li>
      </ul>
      <p className="text-sm leading-relaxed">
        Once at least one conversion event is ingested (typically within 24–48
        hours of first app open for active users), the feature vector becomes
        non-zero and the user becomes eligible for full persona-assigned bandit
        optimization.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">Roadmap</h2>
      <p className="text-sm leading-relaxed">
        The current 10-dim layout is a manually-bucketed intermediate step. The
        next planned iteration is data-driven dimensionality reduction: extract
        all stored feature vectors, run PCA and NMF analysis to identify how
        many components explain ≥85% of variance in the actual user population,
        and replace this hand-crafted layout with a projection matrix applied at
        compute time. Longer-term, UMAP + HDBSCAN would eliminate the need to
        choose k for persona clustering upfront by deriving both the embedding
        dimension and the cluster count from data density.
      </p>
    </article>
  );
}
