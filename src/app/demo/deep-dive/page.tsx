import Link from "next/link";
import { NexusVideoPlayer } from "@/components/video/nexus-video-player";

const CHAPTERS = [
  {
    num: 1,
    slug: "feature-vectors",
    title: "Feature Vectors",
    description:
      "How 10 behavioral and semantic signals are bucketed into a compact vector representing a user's engagement profile. Covers channel affinity, temporal engagement ratios, and YouVersion-specific depth signals.",
  },
  {
    num: 2,
    slug: "persona-clustering",
    title: "Persona Clustering",
    description:
      "k-means++ clustering over cosine distance maps users to archetypes; silhouette scoring selects the optimal k. Explores stability runs, convergence criteria, and cold-start handling.",
  },
  {
    num: 3,
    slug: "bandit-algorithms",
    title: "Bandit Algorithms",
    description:
      "Thompson Sampling, Epsilon-Greedy, and LinUCB — when to use each, the Beta distribution math, and how exploration/exploitation is balanced. Includes per-persona arm statistics.",
  },
  {
    num: 4,
    slug: "reward-calculus",
    title: "Reward Calculus",
    description:
      "Tiered rewards, normalization to [−1, 1], attribution windows, temporal decay, and how each signal updates arm statistics. Covers goal weighting and the reward aggregation pipeline.",
  },
  {
    num: 5,
    slug: "lift-measurement",
    title: "Lift Measurement",
    description:
      "Two-proportion z-tests, bootstrap confidence intervals, and how to interpret CTR lift against a random-assignment baseline. Explains statistical power and the minimum detectable effect.",
  },
  {
    num: 6,
    slug: "send-time-optimization",
    title: "Send-Time Optimization",
    description:
      "Deriving preferred UTC send hours from last_seen_at, the 10-minute pre-session offset, and Braze's in_local_time semantics. Covers fallback logic and frequency capping interactions.",
  },
];

export default function DeepDiveOverviewPage() {
  return (
    <>
      <article className="prose-sm max-w-none space-y-2">
      <h1 className="text-2xl font-bold mb-1">Advanced Data Science</h1>
      <p className="text-muted-foreground text-sm mb-6">
        A technical deep-dive into the mathematics and algorithms that power
        Nexus&apos;s engagement optimization engine. Estimated reading time: 20
        minutes.
      </p>

      <p className="text-sm leading-relaxed">
        Nexus operates as a contextual multi-armed bandit system whose objective
        is to maximize a scalar reward signal derived from user engagement events
        — opens, conversions, donations, and reading-plan completions — across
        push, email, and in-app message channels. Every user is represented as a
        point in a 10-dimensional feature space encoding channel affinity,
        temporal engagement ratios (morning, evening, weekend), overall conversion rate,
        and YouVersion-specific depth signals (recency, giving tier, spiritual depth composite,
        and engagement frequency). These vectors are compressed into behavioral archetypes via
        k-means++ clustering over cosine distance, producing a small set of
        personas — typically 4–9 — that each receive independent bandit models.
      </p>
      <p className="text-sm leading-relaxed">
        The bandit layer itself supports three algorithms: Thompson Sampling
        (default), Epsilon-Greedy, and LinUCB. Thompson Sampling maintains a
        Beta(α, β) distribution per message variant per persona, drawing a
        reward sample from each arm at send time and dispatching whichever arm
        produces the highest draw. LinUCB extends this with a linear regression
        context model that conditions arm selection on the user&apos;s raw
        feature vector, enabling finer-grained personalization beyond
        persona-level segmentation. Rewards are normalized to [−1, 1] before
        updating arm statistics, with tiered goal weights, a 24-hour attribution
        window, and an exponential temporal decay factor. The chapters below
        document each layer of this pipeline with full mathematical derivations.
      </p>

      <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 my-4">
        <p className="text-sm">
          These pages reflect the actual implementation in{" "}
          <span className="font-mono text-xs">src/lib/engine/</span>. Code
          references point to real functions — cross-reference with the source
          for implementation details not covered here.
        </p>
      </div>

      <div className="my-8 rounded-xl border bg-card/40 p-5">
        <div className="text-[11px] font-mono tracking-widest uppercase mb-1 text-[#57a16c]">
          Watch
        </div>
        <p className="text-sm font-semibold mb-1">
          The whole engine, explained — in one minute, five, or ten.
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Same deep-dive, three depths. Pick a length and a narrator.
        </p>
        <NexusVideoPlayer
          basePath="/videos/nexus-advanced"
          lengths={[
            { key: "1min", label: "1 min" },
            { key: "5min", label: "5 min" },
            { key: "10min", label: "10 min" },
          ]}
          defaultLength="1min"
          defaultVoice="heart"
          accent="#57a16c"
          portrait
          collapsible
          title="Watch the deep-dive"
        />
      </div>

      <h2 className="text-lg font-bold mt-8 mb-3">Chapters</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {CHAPTERS.map((ch) => (
          <Link
            key={ch.slug}
            href={`/demo/deep-dive/${ch.slug}`}
            className="block rounded-lg border bg-card p-5 hover:border-[#57a16c]/60 hover:bg-muted/20 transition-colors group"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#57a16c]/15 text-[#57a16c] text-xs font-bold shrink-0 mt-0.5">
                {ch.num}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm leading-snug mb-1">
                  {ch.title}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {ch.description}
                </p>
                <p className="text-[#57a16c] text-xs mt-3 font-medium group-hover:underline">
                  → Read chapter
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </article>
    </>
  );
}
