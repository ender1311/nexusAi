export default function FeatureVectorsPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold mb-1">Feature Vectors</h1>
      <p className="text-muted-foreground text-sm mb-6">
        How 44 behavioral and semantic signals are normalized into a single
        vector representing a user&apos;s engagement profile.
      </p>

      <p className="text-sm leading-relaxed">
        Every user in Nexus is represented as a point in a 44-dimensional
        vector space. This representation — the feature vector — serves two
        purposes. First, it provides the input to k-means++ persona clustering:
        users whose vectors are nearby (under cosine distance) are grouped into
        the same behavioral archetype. Second, it supplies the context variable{" "}
        <span className="font-mono text-xs">x</span> consumed by the LinUCB
        contextual bandit, which conditions arm selection on the user&apos;s
        current behavioral profile rather than only their persona membership.
        The 44 dimensions fall into two broad bands: behavioral dimensions
        [0–36] derived from Nexus decision and conversion logs, and semantic
        dimensions [37–43] synced from Braze custom attributes via Hightouch
        and encoding YouVersion-specific engagement depth.
      </p>
      <p className="text-sm leading-relaxed">
        The goal of the normalization choices described below is to produce a
        vector where every dimension lives in a comparable range — predominantly
        [0, 1] — so that cosine similarity is not dominated by a single
        high-magnitude dimension. Absolute counts are never stored raw; they are
        either converted to rates, log-scaled, or L1-normalized depending on the
        statistical properties of the underlying distribution.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Behavioral Dimensions [0–36]
      </h2>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [0–2] Channel Affinity
      </h3>
      <p className="text-sm leading-relaxed">
        The first three dimensions encode raw per-channel conversion rates for
        push notifications, email, and in-app messages respectively. Each
        dimension is computed as:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[i] = converted[ch] / sent[ch]
      </div>
      <p className="text-sm leading-relaxed">
        These are intentionally <em>not</em> further normalized relative to one
        another. Absolute channel preference matters: a user who converts on 40%
        of push messages and 2% of emails is meaningfully different from one
        with 15% push and 14% email, even though both vectors would look similar
        under cross-channel normalization. Keeping raw rates preserves this
        signal. Division by zero is guarded: if{" "}
        <span className="font-mono text-xs">sent[ch] = 0</span>, the dimension
        is set to 0.0 (no evidence of preference in that channel).
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [3–26] Hourly Engagement Curve
      </h3>
      <p className="text-sm leading-relaxed">
        Dimensions 3 through 26 encode a 24-bin histogram of when, in UTC hour
        of day, a user&apos;s conversions occur. The raw bin counts are
        L1-normalized so the distribution sums to 1:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        normHourly[h] = rawHourly[h] / Σ_h rawHourly[h]
      </div>
      <p className="text-sm leading-relaxed">
        This transforms absolute volume into a pure probability distribution
        over hours. A user with 1,000 conversions concentrated at 08:00 will
        have the same hourly curve as a user with 10 conversions at the same
        hour — making the representation a statement about <em>when</em> a user
        engages, not <em>how often</em>. Engagement frequency is captured
        separately in dimension 35. If a user has zero conversions (all bins
        zero), the normalization denominator is zero and all hourly dimensions
        are left at 0.0, which the cold-start fallback handles downstream.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <p className="text-sm">
          The 24-bin hourly curve is the densest component of the feature
          vector (24 of 44 dimensions) and contributes the most to cosine
          distance between users. Send-time optimization relies directly on
          this sub-vector to derive the preferred UTC send hour.
        </p>
      </div>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [27–33] Day-of-Week Curve
      </h3>
      <p className="text-sm leading-relaxed">
        Seven dimensions encode the day-of-week histogram (0 = Sunday through
        6 = Saturday) using the same L1 normalization as the hourly curve:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        normDoW[d] = rawDoW[d] / Σ_d rawDoW[d]
      </div>
      <p className="text-sm leading-relaxed">
        For many YouVersion users, Sunday engagement spikes dramatically due
        to liturgical patterns (church services, weekend Bible reading, giving
        campaigns). This dimension captures that signal in a way that
        generalizes to non-liturgical users as well: a user who consistently
        engages on Tuesdays and Wednesdays will cluster with others sharing
        that midweek pattern regardless of total volume.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [34] Overall Conversion Rate
      </h3>
      <p className="text-sm leading-relaxed">
        A single scalar representing the user&apos;s aggregate engagement rate
        across all channels and time periods:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[34] = totalConversions / totalDecisions
      </div>
      <p className="text-sm leading-relaxed">
        This dimension provides a global responsiveness signal that is not
        channel-specific. A user with a very high overall conversion rate is
        likely a high-intent user who responds reliably to most messages
        regardless of channel — valuable context for both persona clustering and
        the LinUCB arm selection.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [35] Engagement Frequency
      </h3>
      <p className="text-sm leading-relaxed">
        Raw decision counts follow a heavy-tailed distribution — most users
        receive fewer than 20 messages per month, but a small number of
        high-frequency test accounts or power users may accumulate thousands.
        Storing raw counts would make frequency the dominant dimension in any
        distance metric. Instead, Nexus applies a log transformation scaled so
        that 100 decisions maps to 1.0:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[35] = log(1 + decisions/4) / log(1 + 100)
      </div>
      <p className="text-sm leading-relaxed">
        The <span className="font-mono text-xs">/4</span> factor inside the
        logarithm compresses the low end: a user with 4 decisions gets
        <span className="font-mono text-xs"> log(2)/log(101) ≈ 0.151</span>,
        while 100 decisions gives approximately 1.0 and values above 100 exceed
        1.0 but remain finite. This is clipped at 1.0 before storage. The
        denominator <span className="font-mono text-xs">log(1 + 100)</span>{" "}
        was chosen empirically to match the 95th percentile of decision counts
        in the YouVersion user base.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [36] Average Reward Magnitude
      </h3>
      <p className="text-sm leading-relaxed">
        The mean absolute reward across all conversions, clipped to [0, 1]:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[36] = min(1, |totalReward / totalConversions|)
      </div>
      <p className="text-sm leading-relaxed">
        This encodes how <em>valuable</em> a user&apos;s conversions are, not
        merely how frequent. A user who converts rarely but always donates will
        have a high reward magnitude, while a user who opens every push
        notification but never converts a high-value goal will have a lower
        magnitude despite more frequent conversions. Combined with dimension 34
        (overall rate), these two scalars encode both the frequency and quality
        of the user&apos;s engagement.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Semantic Dimensions [37–43]
      </h2>
      <p className="text-sm leading-relaxed">
        Dimensions 37–43 encode YouVersion-specific engagement depth signals.
        These are synced from Braze custom attributes via a Hightouch reverse
        ETL pipeline and stored on the{" "}
        <span className="font-mono text-xs">User</span> model. Unlike the
        behavioral dimensions, these signals are not derived from Nexus
        decision logs — they represent the user&apos;s broader relationship with
        the YouVersion platform.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [37] Giver Tier
      </h3>
      <p className="text-sm leading-relaxed">
        Ordinal encoding of donation behavior: 0.0 = no giving history, 0.5 =
        has donated (giver), 1.0 = recurring or high-value donor (sower). This
        is a direct ordinal encoding rather than one-hot because the dimension
        is intended to represent a monotonic depth signal — more giving implies
        deeper financial commitment — and cosine similarity handles ordinal
        dimensions correctly when combined with the other dimensions.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [38] Streak Depth
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[38] = min(1, plan_day_current_month_count / 31)
      </div>
      <p className="text-sm leading-relaxed">
        Reading plan consistency this month, normalized by 31 (the maximum days
        in a month). A value of 1.0 represents a user who has completed a plan
        day every single day of the current month. This is a recency-biased
        signal — it resets each month — making it a strong indicator of current
        engagement rather than historical behavior.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [39] Recency Score
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[39] = 1 - min(1, days_since_last_open / 90)
      </div>
      <p className="text-sm leading-relaxed">
        A decay signal: 1.0 for a user who opened the app today, linearly
        decaying to 0.0 at 90 days of inactivity, and clamped at 0.0 beyond 90
        days. The 90-day threshold was chosen to match YouVersion&apos;s
        definition of a dormant user. Combined with streak depth [38], these
        two dimensions give the bandit model a clear signal about whether the
        user is currently active or lapsed.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [40] Plan Depth
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[40] = log(1 + plan_finish_lifetime_count) / log(501)
      </div>
      <p className="text-sm leading-relaxed">
        Lifetime reading plan completions, log-scaled with 500 finishes as the
        power-user ceiling. The denominator{" "}
        <span className="font-mono text-xs">log(501)</span> maps 500 finishes to
        1.0. This signal distinguishes casual readers (1–5 plan completions)
        from habitual ones (50+) from lifelong devotional practitioners (200+),
        compressing the long tail without losing signal at the low end.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [41] Prayer Depth &amp; [42] Scripture Depth
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[41] = min(1, gp_current_month_count / 30){"\n"}
        vec[42] = min(1, gs_current_month_count / 30)
      </div>
      <p className="text-sm leading-relaxed">
        Guided prayer and guided scripture session counts for the current
        month, capped at 30 (daily usage). These two dimensions encode
        engagement with YouVersion&apos;s more contemplative content formats
        separately from reading plan behavior, as their audience skews
        differently: guided scripture users tend to be older, higher-giving,
        and more liturgically rooted, while guided prayer users are often in an
        earlier stage of spiritual practice.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        [43] Badge Depth
      </h3>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        vec[43] = log(1 + badge_lifetime_count) / log(201)
      </div>
      <p className="text-sm leading-relaxed">
        Lifetime badge count, log-scaled with 200 badges as the power-user
        ceiling. Badges are awarded for a wide range of in-app achievements —
        streaks, plan completions, giving milestones, and community actions —
        making badge count a broad proxy for overall platform engagement depth
        that correlates with but is not reducible to any single behavioral
        dimension.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Why Cosine Similarity, Not Euclidean Distance?
      </h2>
      <p className="text-sm leading-relaxed">
        The behavioral sub-vector [3–33] is sparse by construction: most users
        have significant conversion volume in at most 4–6 hours of the day and
        1–2 days of the week. The remaining 16+ bins are zero or near-zero.
        Euclidean distance is fundamentally a magnitude-sensitive metric: the
        L2 distance between a user with 1,000 push conversions (large hourly
        bins before L1 normalization) and one with 10 conversions (small bins)
        would be large even if both users engage exclusively at 08:00 on
        Sundays. After L1 normalization, the raw-count problem is resolved, but
        a different magnitude issue remains: users with more dimensions
        populated (more diverse timing) will have a smaller L2 norm than users
        concentrated in a single hour, making the Euclidean distance
        systematically biased toward spread-out distributions.
      </p>
      <p className="text-sm leading-relaxed">
        Cosine similarity measures the angle between two vectors, making it
        invariant to magnitude. Two vectors that point in the same direction
        — representing identical behavioral profiles at different absolute
        volumes — will have cosine similarity of 1.0 regardless of their norms:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        cos(u, v) = (u · v) / (‖u‖ · ‖v‖)
      </div>
      <p className="text-sm leading-relaxed">
        The range of cosine similarity is [−1, 1] in general, but because all
        44 dimensions of our feature vectors are non-negative (rates, log-scaled
        counts, normalized histograms), the dot product{" "}
        <span className="font-mono text-xs">u · v</span> is always ≥ 0 and the
        practical range is [0, 1]. We define cosine <em>distance</em> as{" "}
        <span className="font-mono text-xs">1 − cos(u, v)</span> ∈ [0, 1],
        which is a valid dissimilarity metric (though not a true metric because
        it does not satisfy the triangle inequality strictly). The k-means and
        persona assignment code use this distance throughout.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Why Log-Scaling Frequency Signals?
      </h2>
      <p className="text-sm leading-relaxed">
        Raw counts — plan completions, badge counts, decision counts — exhibit
        heavy-tailed distributions with a small number of extreme values orders
        of magnitude above the median. Storing raw counts would cause the
        distance metric to be dominated by users near the extremes. A log
        transform compresses the tail while preserving relative ordering and
        keeping small values distinguishable:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {`log(1 + x) maps {0, 1, 10, 100, 500} → {0, 0.69, 2.40, 4.61, 6.22}`}
      </div>
      <p className="text-sm leading-relaxed">
        Normalizing by a power-user ceiling (e.g.,{" "}
        <span className="font-mono text-xs">log(501)</span> for plan depth)
        maps the practical maximum to 1.0 while leaving the scale of lower
        values proportional. The{" "}
        <span className="font-mono text-xs">1 +</span> inside the logarithm
        ensures <span className="font-mono text-xs">log(1 + 0) = 0</span> —
        the no-activity baseline always maps to zero, preserving the semantic
        meaning of that dimension.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">Cold-Start Users</h2>
      <p className="text-sm leading-relaxed">
        New users have all-zero feature vectors: no decision log, no Braze
        attributes synced yet. The cosine similarity formula requires at least
        one non-zero vector to produce a meaningful result —{" "}
        <span className="font-mono text-xs">‖u‖ = 0</span> makes the
        denominator zero and the similarity undefined. Rather than assigning a
        synthetic persona, Nexus handles this at two levels:
      </p>
      <ul className="text-sm leading-relaxed list-disc ml-5 space-y-1">
        <li>
          <strong>Persona assignment:</strong> The cron skips users whose
          feature vector is all-zero; they are not assigned to any persona and
          are not eligible for agent sends that require persona targeting.
        </li>
        <li>
          <strong>Arm selection:</strong> If a user somehow reaches arm
          selection without persona data, Nexus falls back to the global prior{" "}
          <span className="font-mono text-xs">Beta(1, 30)</span> — a
          heavy-exploration prior reflecting no evidence of any arm being
          superior.
        </li>
        <li>
          <strong>Send-time scheduling:</strong> Without an hourly curve, the
          preferred send hour is undefined. The cron uses the agent&apos;s
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
    </article>
  );
}
