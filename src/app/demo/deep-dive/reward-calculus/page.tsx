export default function RewardCalculusPage() {
  return (
    <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold">Reward Calculus</h1>
      <p className="text-muted-foreground">
        How conversion events become numerical signals that update arm confidence distributions.
      </p>

      {/* ── Reward Tiers ────────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Reward Tiers</h2>
      <p>
        Goals are configured per agent with a tier and a value weight. The tier controls the base
        reward magnitude; the value weight scales it. The five tiers are:
      </p>
      <div className="overflow-x-auto my-4">
        <table className="text-sm w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-semibold">Tier</th>
              <th className="text-left py-2 pr-4 font-semibold">Base reward</th>
              <th className="text-left py-2 font-semibold">Typical use case</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-[#57a16c]">best</td>
              <td className="py-2 pr-4 font-mono">+10</td>
              <td className="py-2">
                <span className="font-mono">plan_completed</span>,{" "}
                <span className="font-mono">plan_read_day_7</span> (30-day attribution)
              </td>
            </tr>
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">very_good</td>
              <td className="py-2 pr-4 font-mono">+7</td>
              <td className="py-2">
                <span className="font-mono">plan_started</span>,{" "}
                <span className="font-mono">plan_read_day_3</span>
              </td>
            </tr>
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">good</td>
              <td className="py-2 pr-4 font-mono">+5</td>
              <td className="py-2">
                <span className="font-mono">bible_opened</span>, scripture session
              </td>
            </tr>
            <tr className="border-b border-muted">
              <td className="py-2 pr-4 font-medium text-foreground">neutral</td>
              <td className="py-2 pr-4 font-mono">0</td>
              <td className="py-2">No conversion (implicit: β +1)</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium text-red-500">worst</td>
              <td className="py-2 pr-4 font-mono">−10</td>
              <td className="py-2">
                <span className="font-mono">push_disabled</span> (90-day retroactive lookback)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Reward Normalization ─────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Reward Normalization</h2>
      <p>
        Raw reward is computed first, then clamped to the interval{" "}
        <span className="font-mono">[-1, 1]</span>:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        raw = TIER_BASE × valueWeight{"\n"}
        r   = clamp(raw / 100, -1, 1)
      </div>
      <p>
        Division by 100 is intentional. A &quot;best&quot; goal at weight 1.0 produces{" "}
        <span className="font-mono">r = 10/100 = 0.1</span> — a modest fractional increment to α.
        This prevents any single conversion event from dominating the arm&apos;s distribution and
        keeps the Beta parameters from inflating rapidly relative to the decay rate.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <strong>Value weights</strong> allow goal priorities to be tuned without changing tier
        definitions. An agent focused on long-form plan completion might set{" "}
        <span className="font-mono">plan_completed.valueWeight = 2.0</span>, giving{" "}
        <span className="font-mono">r = 0.2</span> per completion — double the standard best-tier
        reward.
      </div>

      {/* ── Alpha/Beta Update ────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">The Alpha/Beta Update</h2>
      <p>After a decision resolves with reward r:</p>
      <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border my-3">
        <code>{`if r > 0:
  α_new = α + r        // fractional increment
else:
  β_new = β + 1        // binary failure increment

wins_new = wins + (r > 0 ? 1 : 0)`}</code>
      </pre>
      <p>
        The asymmetry is deliberate. Successes increment α by the fractional reward (0.05–1.0),
        encoding reward magnitude into the distribution. Failures always increment β by exactly 1,
        treating all non-conversions equivalently. This means the engine learns{" "}
        <em>how good</em> successful outcomes are while learning only{" "}
        <em>how often</em> failures occur — a natural fit for conversion rate optimization where
        failure is failure regardless of circumstance.
      </p>

      {/* ── UserArmStats vs PersonaArmStats ─────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">UserArmStats vs PersonaArmStats</h2>
      <p>Arm statistics are maintained at two levels:</p>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>
          <span className="font-mono">PersonaArmStats (personaId, agentId, variantId)</span> — the
          shared prior for all users in a persona segment
        </li>
        <li>
          <span className="font-mono">UserArmStats (userId, agentId, variantId)</span> — per-user
          posterior, updated identically
        </li>
      </ul>
      <p>
        At decide time, both levels are loaded and blended: user-level stats are merged with
        persona-level stats to produce the effective <span className="font-mono">(α, β)</span> used
        for sampling. Users with many observations have their personal stats weighted heavily;
        cold-start users fall back almost entirely to the persona prior. The blending formula
        weights by observation count, so the transition from persona-dominant to user-dominant is
        smooth and proportional.
      </p>

      {/* ── Attribution Windows ─────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Attribution Windows</h2>
      <p>
        Events do not arrive instantaneously. Attribution windows link a decision to the conversion
        that followed it:
      </p>
      <ul className="list-disc list-inside space-y-2 text-sm">
        <li>
          <strong>Standard goals</strong>: 48-hour window —{" "}
          <span className="font-mono">sentAt ≤ conversionAt ≤ sentAt + 48h</span>
        </li>
        <li>
          <strong>Long-horizon goals</strong> (<span className="font-mono">plan_completed</span>,{" "}
          <span className="font-mono">plan_read_day_7</span>): 30-day window — plan engagement
          unfolds slowly; attributing only 48-hour opens would undercount
        </li>
        <li>
          <strong>push_disabled</strong>: 90-day retroactive lookback — applies the penalty to all
          decisions sent in the prior 90 days from the moment the event is received
        </li>
      </ul>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        The retroactive <span className="font-mono">push_disabled</span> penalty is the most
        aggressive signal in the system. When a user disables push notifications, the engine
        interprets this as a strong negative signal across recent sends — not just the last one.
        All β values for decisions within the 90-day window receive the{" "}
        <span className="font-mono">r = -0.1</span> penalty update.
      </div>

      {/* ── Temporal Decay ──────────────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Temporal Decay</h2>
      <p>After each α/β update, both parameters are decayed:</p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        α *= 0.99{"\n"}
        β *= 0.99
      </div>
      <p>
        A reward of <span className="font-mono">r=1.0</span> received ten updates ago contributes{" "}
        <span className="font-mono">1.0 × 0.99¹⁰ ≈ 0.905</span> to the current α. After 100
        updates: <span className="font-mono">0.99¹⁰⁰ ≈ 0.366</span>. Functionally, old
        observations have a half-life of approximately 69 updates. The model never fully forgets,
        but becomes increasingly present-weighted — seasonal or content-driven shifts in conversion
        rates propagate through the arm distributions within weeks rather than requiring manual
        resets.
      </p>

      {/* ── Property-Weighted Goals ─────────────────────────────── */}
      <h2 className="text-lg font-bold mt-8 mb-3">Property-Weighted Goals</h2>
      <p>
        When <span className="font-mono">weightMode = &quot;property&quot;</span>, the reward
        multiplier comes from an event property rather than a fixed value. For example: a{" "}
        <span className="font-mono">donation_made</span> event with{" "}
        <span className="font-mono">weightProperty = &quot;amount_usd&quot;</span> uses the actual
        donation amount as the multiplier. The normalization and clamp still apply:
      </p>
      <div className="font-mono text-sm bg-muted/40 rounded-lg p-4 my-4 overflow-x-auto border">
        raw = TIER_BASE × event.properties[weightProperty]{"\n"}
        r   = clamp(raw / 100, -1, 1)
      </div>
      <p>
        This allows the arm distributions to learn not just whether users convert, but how valuable
        their conversions are — naturally weighting variant selection toward arms that drive
        higher-magnitude outcomes.
      </p>
    </article>
  );
}
