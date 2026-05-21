export default function BanditAlgorithmsPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold">Bandit Algorithms</h1>
      <p className="text-muted-foreground">
        Thompson Sampling, LinUCB, and Epsilon-Greedy — the explore/exploit engines that select
        which message variant to send.
      </p>

      {/* ── Explore/Exploit ─────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">The Explore/Exploit Tradeoff</h2>
      <p>
        The core tension in online learning: sending only the best-known variant maximizes
        short-term performance but never discovers whether a newer variant is better. Sending
        variants uniformly at random discovers quickly but wastes sends on weak options. Bandit
        algorithms find a principled middle ground — allocating traffic proportionally to each
        arm&apos;s estimated quality while preserving enough uncertainty-driven exploration to
        surface improvements.
      </p>
      <p>
        In Nexus, each &quot;arm&quot; is a message variant. At decision time, the engine selects
        one arm per user based on the algorithm configured for that agent. Over thousands of sends,
        traffic naturally concentrates on higher-performing variants while low performers are
        de-emphasized — not discarded.
      </p>

      {/* ── Thompson Sampling ───────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Thompson Sampling (Default Algorithm)</h2>
      <p>
        Thompson Sampling models each arm&apos;s unknown conversion probability as a Beta
        distribution, updated with observed reward signals. Each arm <em>k</em> maintains two
        parameters:
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          <span className="font-mono">αₖ</span> — accumulated positive reward (weighted successes)
        </li>
        <li>
          <span className="font-mono">βₖ</span> — accumulated failure count
        </li>
      </ul>

      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        E[θₖ] = αₖ / (αₖ + βₖ){"\n"}
        {"\n"}
        Var[θₖ] = αₖβₖ / [(αₖ+βₖ)²(αₖ+βₖ+1)]
      </div>

      <p>
        At decision time the engine draws a sample <span className="font-mono">θₖ ~ Beta(αₖ, βₖ)</span>{" "}
        for every arm and selects the arm with the highest draw. This single rule unifies
        exploration and exploitation: arms with high expected value draw high most of the time, but
        arms with wide distributions (few observations) occasionally draw higher still, earning them
        exploratory sends.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Concrete Example</h3>
      <p>
        Consider Arm B (<span className="font-mono">α=38, β=8</span>) vs Arm C (
        <span className="font-mono">α=5, β=5</span>):
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          Arm B: <span className="font-mono">E[θ]=0.826</span>, tight distribution — reliably draws
          high on most samples
        </li>
        <li>
          Arm C: <span className="font-mono">E[θ]=0.5</span>, wide distribution — occasionally draws
          very high, earning exploration sends
        </li>
      </ul>
      <p>
        Arm B wins most decisions, but Arm C gets enough sends to accumulate evidence. If Arm
        C&apos;s true CTR is 0.7, its α will climb and it will eventually displace Arm B.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Pessimistic Initialization</h3>
      <p>
        New arms are initialized at <span className="font-mono">Beta(1, 30)</span>, giving an
        expected value of <span className="font-mono">E[θ] = 1/31 ≈ 0.032</span>. This matches
        real-world push CTR (~3%) and prevents new, unproven variants from &quot;stealing&quot;
        sends during warm-up. A new arm needs approximately 30 sends before its distribution
        narrows enough to compete on merit.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <strong>Why not Beta(1,1)?</strong> A uniform prior would give each new arm an expected
        value of 0.5 — far above the real 3% CTR baseline. This causes new variants to receive a
        large initial traffic burst before any evidence exists, distorting early results. The
        pessimistic prior treats the prior as a soft claim of &quot;this arm probably performs like
        an average push.&quot;
      </div>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        Sampling Implementation (Marsaglia-Tsang + Box-Muller)
      </h3>
      <p>
        The engine generates Beta samples by composing two Gamma samples, avoiding any external
        math library dependency. The Marsaglia-Tsang method is used for Gamma sampling:
      </p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`sampleGamma(shape):
  d = shape - 1/3
  c = 1 / sqrt(9d)
  loop:
    x = randomNormal()      // Box-Muller transform
    v = (1 + c·x)³
    if uniform < 1 - 0.0331·x⁴:  return d·v
    if log(uniform) < 0.5·x² + d·(1 - v + log(v)):  return d·v

sampleBeta(α, β):
  x = sampleGamma(α)
  y = sampleGamma(β)
  return x / (x + y)`}</code>
      </pre>
      <p>
        The Box-Muller transform converts two uniform random variables into a standard normal. The
        Marsaglia-Tsang acceptance-rejection loop is O(1) amortized. Together, each Beta sample
        requires roughly 1–2 loop iterations on average.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Recency Penalties</h3>
      <p>
        Arm selection scores can be multiplied by a{" "}
        <span className="font-mono">recencyPenalty ∈ [0.2, 1.0]</span> derived from{" "}
        <span className="font-mono">daysSinceSent</span>. This deprioritizes variants that were sent
        to a specific user very recently without fully eliminating them. A user who received Arm B
        yesterday will see its effective draw deflated; the engine may select Arm C even if its raw
        sample was lower. This prevents the same variant from dominating a single user&apos;s send
        history.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Temporal Decay</h3>
      <p>
        After each α/β update, both parameters are decayed:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        α *= 0.99{"\n"}
        β *= 0.99
      </div>
      <p>
        This slowly shrinks the weight of historical observations, keeping the model adaptive to
        trend shifts. A variant that was strong six months ago cannot coast indefinitely — its α and
        β converge toward zero over time, eventually reverting toward the prior. The decay rate of
        0.99 per update gives observations a half-life of approximately 69 updates.
      </p>

      {/* ── LinUCB ──────────────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">LinUCB (Contextual Bandit)</h2>
      <p>
        Thompson Sampling is context-free — it ignores the user&apos;s feature vector when
        selecting an arm. LinUCB incorporates context by learning a linear reward model per arm,
        allowing it to personalize decisions based on user features.
      </p>
      <p>
        Each arm <em>k</em> maintains two structures (where <em>d</em>=10, the feature dimension):
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          <span className="font-mono">A⁻¹</span> — inverse of the design matrix, shape (d×d),
          initialized to identity I_d
        </li>
        <li>
          <span className="font-mono">b</span> — accumulated reward vector, shape (d,), initialized
          to zeros
        </li>
      </ul>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">Estimator and UCB Score</h3>
      <p>
        The ridge regression solution maps features to expected reward:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        θₖ = A⁻¹ · b{"\n"}
        {"\n"}
        score(k, x) = θₖᵀx + α · √(xᵀ A⁻¹ x){"\n"}
        {"              "}↑ exploit    ↑ explore (uncertainty bonus)
      </div>
      <p>
        The <span className="font-mono">xᵀA⁻¹x</span> term is large when the feature vector{" "}
        <span className="font-mono">x</span> points in a direction the arm has not been exposed to
        yet — high uncertainty produces a high exploration bonus. As an arm accumulates sends across
        diverse feature vectors, the matrix <span className="font-mono">A</span> fills in and the
        UCB bound tightens.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        Update: Sherman-Morrison Rank-1 Inverse
      </h3>
      <p>
        A full matrix inversion at every update step would be O(d³). The Sherman-Morrison formula updates{" "}
        <span className="font-mono">A⁻¹</span> in O(d²):
      </p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`v        = A⁻¹ · x
A⁻¹_new  = A⁻¹ - (v · vᵀ) / (1 + xᵀ · v)
b_new    = b + reward · x`}</code>
      </pre>
      <p>
        This keeps each decision update within microseconds even when running across thousands of
        users in a single cron batch.
      </p>

      <h3 className="text-base font-semibold mt-6 mb-2 text-[#57a16c]">
        When to Use LinUCB vs Thompson Sampling
      </h3>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          <strong>Thompson Sampling</strong>: works well when the bandit is persona-segmented
          (context already collapsed into segment membership), offers fast inference, and requires no
          matrix storage per arm
        </li>
        <li>
          <strong>LinUCB</strong>: better when fine-grained personalization matters within a
          segment, or when variant copy has semantic features that should generalize across users
          (e.g., &quot;long variants work better for high streak-depth users&quot;)
        </li>
      </ul>

      {/* ── Epsilon-Greedy ──────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Epsilon-Greedy (Legacy / Fallback)</h2>
      <p>
        The simplest bandit algorithm. With probability ε (default 0.10), pick a random arm
        (explore). Otherwise pick the arm with the highest empirical win rate{" "}
        <span className="font-mono">wins / tries</span> (exploit).
      </p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          <strong>Pro</strong>: deterministic exploit phase, easy to reason about and audit
        </li>
        <li>
          <strong>Con</strong>: exploration is dumb (uniform random), ε does not adapt to
          confidence levels — a nearly-certain winner still donates ε of its traffic to random arms
        </li>
        <li>
          <strong>When used</strong>: agents explicitly configured for epsilon-greedy; ε decays by
          ×0.995 each run toward a minimum of 0.01
        </li>
      </ul>

      {/* ── Comparison table ────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Algorithm Comparison</h2>
      <div className="overflow-x-auto my-4">
        <table className="text-sm w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-semibold">Property</th>
              <th className="text-left py-2 pr-4 font-semibold text-[#57a16c]">
                Thompson Sampling
              </th>
              <th className="text-left py-2 pr-4 font-semibold text-[#57a16c]">LinUCB</th>
              <th className="text-left py-2 font-semibold text-[#57a16c]">Epsilon-Greedy</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">Uses context</td>
              <td className="py-2 pr-4">No</td>
              <td className="py-2 pr-4">Yes</td>
              <td className="py-2">No</td>
            </tr>
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">Exploration</td>
              <td className="py-2 pr-4">Probabilistic via Beta sampling</td>
              <td className="py-2 pr-4">UCB uncertainty bound</td>
              <td className="py-2">Fixed ε (random)</td>
            </tr>
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">Memory per arm</td>
              <td className="py-2 pr-4">
                2 floats <span className="font-mono">(α, β)</span>
              </td>
              <td className="py-2 pr-4">
                d²+d floats <span className="font-mono">(A⁻¹, b)</span>
              </td>
              <td className="py-2">
                2 ints <span className="font-mono">(wins, tries)</span>
              </td>
            </tr>
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">Cold-start</td>
              <td className="py-2 pr-4">
                <span className="font-mono">Beta(1,30)</span> prior
              </td>
              <td className="py-2 pr-4">
                Identity <span className="font-mono">A⁻¹</span>
              </td>
              <td className="py-2">Equal exploration</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium text-foreground">Best for</td>
              <td className="py-2 pr-4">Persona-segmented agents</td>
              <td className="py-2 pr-4">Fine-grained user context</td>
              <td className="py-2">Simplicity / auditability</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}
