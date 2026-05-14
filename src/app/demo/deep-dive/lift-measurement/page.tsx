export default function LiftMeasurementPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold">Lift Measurement &amp; Statistical Testing</h1>
      <p className="text-muted-foreground">
        How Nexus quantifies improvement over a random-assignment baseline and determines whether
        observed lift is statistically meaningful.
      </p>

      {/* ── Defining Lift ───────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Defining Lift</h2>
      <p>
        Lift is the relative improvement in conversion rate over a baseline. In Nexus, the baseline
        is the random-assignment conversion rate — what you would observe if the bandit selected
        variants uniformly at random, with no learning. The treatment is the bandit-selected
        arm&apos;s observed conversion rate:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        Lift = (CTR_treatment − CTR_control) / CTR_control × 100%
      </div>
      <p>
        A lift of +25% means the bandit&apos;s selected variant converts 25% more users than the
        average across all variants would. Negative lift indicates the bandit is performing worse
        than chance — typically a signal of insufficient training data or a poorly configured reward
        structure.
      </p>

      {/* ── Two-Proportion Z-Test ───────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Two-Proportion Z-Test</h2>
      <p>
        To test whether <span className="font-mono">CTR_treatment ≠ CTR_control</span>, Nexus uses
        a two-tailed two-proportion z-test:
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          <strong>H₀</strong>: p₁ = p₂ (no difference between proportions)
        </li>
        <li>
          <strong>H₁</strong>: p₁ ≠ p₂ (two-tailed)
        </li>
      </ul>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {"p̂ = (x₁ + x₂) / (n₁ + n₂)          // pooled proportion\n"}
        {"SE = √( p̂(1-p̂) · (1/n₁ + 1/n₂) )   // pooled standard error\n"}
        {"Z  = (p̂₁ − p̂₂) / SE                 // test statistic"}
      </div>
      <p>
        Reject H₀ at α=0.05 when{" "}
        <span className="font-mono">|Z| &gt; 1.96</span>. The p-value is{" "}
        <span className="font-mono">2 · (1 − Φ(|Z|))</span> where Φ is the standard normal CDF.
        Results below the significance threshold are displayed with a visual indicator in the
        LiftPanel to discourage acting on noise.
      </p>

      {/* ── Confidence Intervals ────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Confidence Intervals</h2>
      <p>
        The 95% confidence interval for the difference{" "}
        <span className="font-mono">p₁ − p₂</span> uses unpooled standard error (Wald interval):
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        (p̂₁ − p̂₂) ± 1.96 · √( p̂₁(1-p̂₁)/n₁ + p̂₂(1-p̂₂)/n₂ )
      </div>
      <p>
        If this interval excludes zero, the lift is statistically significant at the 5% level. The
        LiftPanel renders this as a horizontal bar: the point estimate is the midpoint, and the
        interval endpoints are the bar extents. Intervals that cross zero are rendered in muted
        color; intervals entirely above zero are rendered in brand green.
      </p>

      {/* ── Minimum Detectable Effect ───────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Minimum Detectable Effect</h2>
      <p>
        To detect a lift of δ with 80% power at α=0.05, the required sample size per group is:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        {"n ≥ 2 · (z_α/2 + z_β)² · p̄(1-p̄) / δ²\n"}
        {"  ≈ 2 · (1.96 + 0.842)² · p̄(1-p̄) / δ²\n"}
        {"\n"}
        {"Example: p̄=0.04 (4% baseline CTR), δ=0.01 (1pp absolute lift)\n"}
        {"  n ≈ 6,000 per group"}
      </div>
      <p>
        This sets the minimum audience size before lift estimates are meaningful. The LiftPanel
        component shows confidence intervals that visibly widen at low n — the wider the bar, the
        less data exists, and the less confident the estimate. Below ~500 decisions per arm,
        intervals are typically so wide they encompass zero regardless of observed direction.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <strong>Practical implication:</strong> A lift metric showing +40% with a 95% CI of
        [−15%, +95%] is not actionable — the interval is too wide. Wait for more sends before
        interpreting directional results. The LiftPanel&apos;s CI visualization is intentionally
        designed to make this ambiguity obvious rather than showing only point estimates.
      </div>

      {/* ── Bandit vs. A/B Testing ──────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">
        Bandit vs. A/B Testing — Why Lift Math Is Different
      </h2>
      <p>
        Classic A/B testing splits traffic equally: <span className="font-mono">n₁ = n₂</span>.
        With Thompson Sampling, the winning arm receives exponentially more traffic over time as its
        Beta distribution narrows. This violates the i.i.d. assumption underlying the standard
        z-test: observations are no longer independent draws from a fixed distribution because the
        selection policy itself changes with each update.
      </p>
      <p>Nexus addresses this with three approaches:</p>
      <ol className="list-decimal list-inside space-y-2 text-sm">
        <li>
          <strong>Historical holdout comparison</strong>: compare bandit-arm CTR to the
          agent&apos;s pre-bandit baseline (if available). This is the cleanest lift estimate when a
          before/after comparison is possible.
        </li>
        <li>
          <strong>Within-bandit variance</strong>: compare arm CTRs to each other using the same
          z-test, acknowledging the traffic imbalance. Under-represented arms have wider CIs, which
          the visualization reflects.
        </li>
        <li>
          <strong>Wilson score intervals</strong> (planned): a better CI for proportions with
          extreme traffic splits, particularly when one arm has very few observations. Wilson
          intervals do not deflate to zero width at low n the way Wald intervals do.
        </li>
      </ol>

      {/* ── Interpreting the LiftPanel ──────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Interpreting the LiftPanel</h2>
      <p>
        The <span className="font-mono">/agents/[id]/performance</span> page shows per-goal lift
        metrics via the LiftPanel component. Each metric displays:
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>Observed CTR for each arm (including decision count)</li>
        <li>Absolute lift in percentage points (pp) and relative lift (%)</li>
        <li>95% confidence interval bounds</li>
        <li>Whether the result crosses the statistical significance threshold</li>
      </ul>
      <p>
        The <strong>Overall Lift</strong> metric uses the best-performing arm versus a uniform
        random baseline — a weighted average of all arm CTRs where each arm receives weight 1/k.
        This provides a single headline number representing the value the bandit adds over naive
        random selection.
      </p>

      {/* ── Common Pitfalls ─────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Common Pitfalls</h2>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Look-Ahead Bias</h3>
      <p>
        Checking significance before sufficient n accumulates inflates the false positive rate. If
        you test after every 100 sends and stop when{" "}
        <span className="font-mono">p &lt; 0.05</span>, you&apos;ll declare significance far more
        than 5% of the time on null effects. Nexus shows CIs that visually widen at low n to signal
        this uncertainty — the intended workflow is to let the bandit run until CIs naturally
        narrow, not to poll for early significance.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Multiple Comparisons</h3>
      <p>
        Testing <em>k</em> arms simultaneously inflates the family-wise error rate. With k=4 arms
        at α=0.05, the probability of at least one false positive across all pairwise comparisons is
        approximately 19%. The Bonferroni correction uses{" "}
        <span className="font-mono">α/k = 0.0125</span> per test, requiring a z-score above ~2.24
        rather than 1.96 to declare significance. This correction is not currently enforced in the
        UI — confidence intervals are per-arm — and interpreting multi-arm comparisons requires
        awareness of this inflation.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Non-Stationarity</h3>
      <p>
        CTR drifts over time due to seasonal content cycles, algorithm changes, and audience
        composition shifts. An arm that achieved 8% CTR in January may only achieve 5% in March,
        not because it degraded in isolation but because the entire baseline shifted. Temporal decay
        in arm stats (α × 0.99 per update) partially addresses this by de-weighting old
        observations, but lift metrics that span long time ranges may mix high and low baseline
        periods, making absolute lift numbers misleading without a time-segmented view.
      </p>
    </article>
  );
}
