export default function PersonaClusteringPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold mb-1">Persona Clustering</h1>
      <p className="text-muted-foreground text-sm mb-6">
        How k-means++ over cosine distance discovers stable behavioral
        archetypes, how silhouette scoring selects the optimal k, and how
        personas are assigned at send time.
      </p>

      <p className="text-sm leading-relaxed">
        Nexus segments users into behavioral archetypes — called personas —
        by running unsupervised clustering over the 44-dimensional feature
        vectors described in Chapter 1. Rather than training a single global
        bandit model that must serve all users with the same arm statistics,
        each persona receives its own independent set of Beta(α, β)
        distributions for every message variant. This means a persona of
        early-morning Sunday devotional readers will accumulate entirely
        different arm statistics from a late-night weekday engagement persona,
        enabling the bandit to learn that Variant A outperforms Variant B for
        one segment even if the reverse is true for another.
      </p>
      <p className="text-sm leading-relaxed">
        Persona discovery runs on a scheduled cron (
        <span className="font-mono text-xs">persona-discovery.ts</span>) and
        produces a set of cluster centroids stored in the{" "}
        <span className="font-mono text-xs">Persona</span> table. Each{" "}
        <span className="font-mono text-xs">User</span> row carries a{" "}
        <span className="font-mono text-xs">personaId</span> foreign key that
        is updated whenever the discovery cron reruns. The process involves
        three distinct phases: k-means++ initialization, the iterative
        assignment-update loop, and silhouette-based model selection across
        multiple values of k.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        k-means++ Initialization
      </h2>
      <p className="text-sm leading-relaxed">
        Standard k-means chooses initial centroids uniformly at random, which
        frequently leads to poor local minima when centroids start near each
        other. k-means++ addresses this by biasing the initialization toward
        centroids that are spread apart in the feature space. The procedure is:
      </p>
      <ol className="text-sm leading-relaxed list-decimal ml-5 space-y-2">
        <li>
          Choose the first centroid uniformly at random from the user dataset.
        </li>
        <li>
          For each remaining centroid to be placed, compute the cosine distance
          from every unselected point to its nearest already-chosen centroid,
          calling this <span className="font-mono text-xs">D(i)</span>. Select
          the next centroid by sampling from the dataset with probability
          proportional to <span className="font-mono text-xs">D(i)²</span>.
        </li>
        <li>Repeat step 2 until k centroids have been chosen.</li>
      </ol>
      <p className="text-sm leading-relaxed">
        The squared-distance weighting ensures that points far from existing
        centroids are strongly preferred, spreading the initial centroids across
        the feature space. The selection probability for point i is:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        P(i) = D(i)² / Σⱼ D(j)²
      </div>
      <p className="text-sm leading-relaxed">
        In practice, k-means++ initialization reduces the number of iterations
        required for convergence and consistently produces higher silhouette
        scores than random initialization — particularly important here because
        our distance metric is cosine distance rather than Euclidean, making the
        loss landscape more complex.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <p className="text-sm">
          Using cosine distance during initialization means{" "}
          <span className="font-mono text-xs">D(i)</span> is computed as{" "}
          <span className="font-mono text-xs">1 − cosine_similarity(i, nearest_centroid)</span>.
          This correctly biases selection toward users whose behavioral profiles
          are most dissimilar to already-chosen centroids, not just those who
          happen to have large feature vector norms.
        </p>
      </div>

      <h2 className="text-lg font-bold mt-8 mb-3">The k-means Loop</h2>
      <p className="text-sm leading-relaxed">
        After initialization, the algorithm iterates between an assignment step
        and an update step until convergence or a maximum of 100 iterations.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        Assignment Step
      </h3>
      <p className="text-sm leading-relaxed">
        Each user is assigned to the cluster whose centroid minimizes cosine
        distance:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        j*(i) = argmin_j [1 − cos(v_i, centroid_j)]
      </div>
      <p className="text-sm leading-relaxed">
        Because cosine similarity is monotonically increasing while cosine
        distance is monotonically decreasing, this is equivalent to assigning
        each user to the cluster with the highest cosine similarity to its
        centroid — the cluster most aligned with the user&apos;s behavioral
        direction.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        Update Step
      </h3>
      <p className="text-sm leading-relaxed">
        New centroids are computed as the arithmetic mean of all assigned
        vectors:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {`centroid_j = (1 / |C_j|) · Σ_{i ∈ C_j} v_i`}
      </div>
      <p className="text-sm leading-relaxed">
        An important subtlety: the arithmetic mean of cosine-normalized vectors
        is <em>not</em> their cosine mean. True spherical k-means would
        normalize each updated centroid back to unit length after each update,
        so that all centroids remain on the unit hypersphere. Nexus uses
        standard Euclidean-mean centroids in an embedding space rather than
        spherical k-means — this is an intentional approximation. The arithmetic
        mean still converges to a stable fixed point and is substantially more
        computationally efficient than spherical k-means, and empirical
        evaluation on YouVersion data shows that silhouette scores are not
        significantly degraded relative to the spherical variant at the dataset
        sizes Nexus operates on (typically 5,000–500,000 users per discovery
        run).
      </p>
      <p className="text-sm leading-relaxed">
        Convergence is declared when no user&apos;s cluster assignment changes
        between the assignment and update steps of successive iterations, or
        when the maximum iteration count (100) is reached. In practice,
        convergence happens in 15–30 iterations for k ≤ 10.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Silhouette Scoring — Selecting k
      </h2>
      <p className="text-sm leading-relaxed">
        The number of personas k is not fixed — it is selected automatically by
        running the k-means procedure for every integer k in{" "}
        <span className="font-mono text-xs">[minK, maxK]</span> (default 3–15)
        and choosing the k that maximizes the mean silhouette score. The
        silhouette coefficient for a single user i is:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {`a(i) = mean cosine distance from i to all other users in its cluster
b(i) = mean cosine distance from i to all users in the nearest other cluster

s(i) = (b(i) − a(i)) / max(a(i), b(i))`}
      </div>
      <p className="text-sm leading-relaxed">
        A silhouette score near 1.0 for user i means the user is well-matched
        to its own cluster (small <span className="font-mono text-xs">a(i)</span>
        ) and far from the next-best cluster (large{" "}
        <span className="font-mono text-xs">b(i)</span>). A score near 0
        indicates ambiguity at the cluster boundary. A negative score means the
        user would be better assigned to the neighboring cluster.
      </p>
      <p className="text-sm leading-relaxed">
        The mean silhouette score over all users is:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        S = (1/n) · Σᵢ s(i)   ∈ [−1, 1]
      </div>
      <p className="text-sm leading-relaxed">
        Nexus uses the following thresholds to characterize cluster quality:
      </p>
      <ul className="text-sm leading-relaxed list-disc ml-5 space-y-1">
        <li>
          <span className="font-mono text-xs">S &gt; 0.70</span> — strong
          structure; clusters are well-separated and internally cohesive
        </li>
        <li>
          <span className="font-mono text-xs">S ∈ [0.50, 0.70]</span> —
          reasonable structure; most users are correctly assigned
        </li>
        <li>
          <span className="font-mono text-xs">S ∈ [0.25, 0.50]</span> — weak
          but acceptable structure; Nexus requires{" "}
          <span className="font-mono text-xs">minSilhouetteScore = 0.25</span>{" "}
          as a minimum acceptance threshold
        </li>
        <li>
          <span className="font-mono text-xs">S &lt; 0.25</span> — the data
          does not cluster reliably at this k; result is discarded
        </li>
      </ul>
      <p className="text-sm leading-relaxed">
        If no k in the search range produces{" "}
        <span className="font-mono text-xs">S ≥ 0.25</span>, the discovery run
        exits without updating the persona table and the existing personas
        remain active. This guards against degraded data (e.g., a sync outage
        that zeros out feature vectors for a large cohort) from corrupting the
        model.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">Stability Runs</h2>
      <p className="text-sm leading-relaxed">
        k-means++ initialization is stochastic — different random seeds can
        yield different centroid placements and therefore different final
        clusters, particularly when the true cluster boundaries are not
        sharply defined. To reduce sensitivity to initialization luck, Nexus
        runs the full k-means procedure{" "}
        <span className="font-mono text-xs">stabilityRuns</span> times (default
        5) for each candidate k and retains the run with the highest silhouette
        score. The winning run&apos;s centroids and assignments are then used
        for silhouette comparison across k values.
      </p>
      <p className="text-sm leading-relaxed">
        Five stability runs is sufficient to guard against the worst-case
        initialization outcomes without making the discovery cron prohibitively
        slow. For a dataset of 50,000 users with k ∈ [3, 10] and 5 stability
        runs each, the total number of k-means runs is{" "}
        <span className="font-mono text-xs">8 × 5 = 40</span>, each converging
        in ~20 iterations over 50,000 vectors — a workload that completes in
        well under 60 seconds on the discovery cron instance.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Cosine Distance vs. Euclidean Distance for Clustering
      </h2>
      <p className="text-sm leading-relaxed">
        The choice of cosine distance over Euclidean distance for this
        clustering task is motivated by the same argument as for persona
        assignment (see Chapter 1) — behavioral feature vectors are sparse and
        magnitude-invariant comparison is required. Cosine distance{" "}
        <span className="font-mono text-xs">d(a, b) = 1 − cos(a, b)</span>{" "}
        has the following properties in the context of our non-negative vectors:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {`d(a, b) = 0   →  identical behavioral direction (same profile, any volume)
d(a, b) = 1   →  orthogonal (completely unrelated patterns)
d(a, b) ≈ 1   →  practical maximum (non-negative vectors cannot be antipodal)`}
      </div>
      <p className="text-sm leading-relaxed">
        The theoretical maximum of{" "}
        <span className="font-mono text-xs">d(a, b) = 2</span> would require
        antiparallel vectors — impossible with non-negative dimensions — so the
        practical range is [0, 1). A user who opens exclusively at 08:00 on
        Sundays (large bin 8 of the hourly curve, large bin 0 of the day-of-week
        curve, all other bins zero) will be at distance ≈ 1 from a user who
        opens exclusively at 23:00 on Fridays, and at distance ≈ 0 from another
        08:00-Sunday user regardless of how many total conversions either has
        accumulated.
      </p>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Persona Assignment at Send Time
      </h2>
      <p className="text-sm leading-relaxed">
        After discovery completes, every user in the database is assigned to
        their nearest persona centroid by maximizing cosine similarity:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        persona*(u) = argmax_p cosine_similarity(v_u, centroid_p)
      </div>
      <p className="text-sm leading-relaxed">
        The cosine similarity value itself serves as the confidence score for
        the assignment, ranging from 0 (the user&apos;s vector is orthogonal to
        the nearest centroid — very weak membership) to 1 (perfectly aligned).
        This confidence score is stored on the{" "}
        <span className="font-mono text-xs">User</span> row and surfaced in the
        persona assignment debug view.
      </p>
      <p className="text-sm leading-relaxed">
        The send cron filters eligible users by agent persona targets: only
        users whose <span className="font-mono text-xs">personaId</span> matches
        one of the agent&apos;s configured{" "}
        <span className="font-mono text-xs">AgentPersonaTarget</span> rows are
        included in the candidate pool for that send. This means a newly
        discovered persona — one not yet configured as a target for any agent
        — will accumulate users but generate no sends until an operator
        explicitly adds it to an agent&apos;s targeting configuration.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <p className="text-sm">
          Assignment runs at ingest time (when new user data arrives from
          Hightouch), not at send time. This means the persona assignment
          reflects the user&apos;s behavioral profile at last sync, which may
          be up to 24 hours stale at the moment of send. For most users this
          is acceptable; for users who complete a significant engagement
          milestone (e.g., first donation) between syncs, the persona
          reassignment will happen on the next sync cycle.
        </p>
      </div>

      <h2 className="text-lg font-bold mt-8 mb-3">
        Plan-Based Persona Tagging
      </h2>
      <p className="text-sm leading-relaxed">
        Beyond unsupervised clustering, Nexus augments persona assignment with
        a rule-based classifier in{" "}
        <span className="font-mono text-xs">plan-persona-classifier.ts</span>.
        This classifier can override the cluster-assigned persona for specific
        high-signal archetypes that would otherwise be diluted across multiple
        clusters. The rules operate on a combination of:
      </p>
      <ul className="text-sm leading-relaxed list-disc ml-5 space-y-1">
        <li>
          The user&apos;s current or most recently completed reading plan and
          its plan set membership (e.g., &quot;Devotional&quot;,
          &quot;Biblical&quot;, &quot;Evangelism&quot;)
        </li>
        <li>
          Lifetime plan completion count (dim [40] of the feature vector)
        </li>
        <li>Giving tier (dim [37])</li>
        <li>
          Guided prayer and guided scripture session counts (dims [41], [42])
        </li>
        <li>
          Funnel stage attribute (e.g.,{" "}
          <span className="font-mono text-xs">funnel_stage = &quot;lapsed&quot;</span>)
        </li>
      </ul>
      <p className="text-sm leading-relaxed">
        The canonical override case is the &quot;Re-engager&quot; persona: a
        user with <span className="font-mono text-xs">funnel_stage = lapsed</span>{" "}
        (recency score [39] below a threshold) and at least one prior plan
        completion is tagged as a Re-engager regardless of which cluster they
        fall into by cosine distance. This matters because lapsed users may
        still have a historical feature vector from their active period that
        places them near active-user clusters — the recency score alone may
        not be strong enough to push them into a distinct cluster if the
        population of lapsed users is small relative to active users.
      </p>
      <p className="text-sm leading-relaxed">
        Rule-based overrides are applied after cluster assignment, not before,
        so the clustering output is not affected. They function as a final
        refinement layer that injects domain knowledge — product-defined
        archetypes the business team cares about — on top of the
        data-driven clustering results. When a rule fires, the override persona
        ID replaces the cluster-assigned persona ID on the{" "}
        <span className="font-mono text-xs">User</span> row, and the original
        cluster assignment is preserved in a separate field for auditing.
      </p>
    </article>
  );
}
