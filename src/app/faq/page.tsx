import { Header } from "@/components/layout/header";
import { FaqAccordion, type FaqCategory } from "@/components/faq/faq-accordion";

const FAQ_CATEGORIES: FaqCategory[] = [
  {
    title: "What is Nexus?",
    emoji: "🌱",
    items: [
      {
        q: "What is Nexus?",
        a: "Nexus is an intelligent messaging engine that automatically learns which message to send to each user — and when — to maximize meaningful engagement. Rather than sending the same notification to everyone, it continuously experiments across your message variants, observes what resonates with each person, and concentrates future sends toward what works. It gets smarter with every message it sends.",
      },
      {
        q: "Who is Nexus built for?",
        a: "Nexus is built for teams who send push notifications, emails, or in-app messages at scale and want those messages to actually drive action — whether that's opening a Bible reading plan, making a donation, or deepening a daily habit. You don't need a data science team or any AI expertise. You define the messages and goals; Nexus handles the optimization.",
      },
      {
        q: "What problem does Nexus solve?",
        a: "Traditional campaigns send the same message to everyone and measure aggregate performance. The result: your most engaged users get messages they don't need, your at-risk users get messages that don't resonate, and you can't tell which variant is actually driving lift. Nexus solves this by treating every user as an individual and every message variant as a hypothesis — then running a continuous, mathematically rigorous test to find the best match.",
      },
      {
        q: "Do I need to understand AI or machine learning to use it?",
        a: "No. You create Agents (campaigns), write message variants, set a goal (opens, donations, completions), and let Nexus do the rest. The underlying algorithms — Thompson Sampling, contextual bandits, clustering — all run invisibly. The UI surfaces what's converging, what's winning, and what to do next in plain language.",
      },
      {
        q: "How is Nexus different from Braze's built-in AI features?",
        a: "Braze's AI (Intelligent Timing, Winning Path, etc.) operates at the campaign level: it finds the best time or variant on average for your whole audience. Nexus operates at the individual level: it learns a separate preference for each user based on their behavioral fingerprint — when they engage, how deeply, what stage of their journey they're in, and how quickly they respond to different message styles. The result is true personalization, not population-level optimization.",
      },
      {
        q: "What messaging channels does Nexus support?",
        a: "Nexus currently supports push notifications (iOS and Android), email, and in-app messages — all dispatched through Braze's REST API. The channel is configured per Agent, and frequency caps, quiet hours, and subscription status are enforced independently per channel.",
      },
      {
        q: "How does Nexus connect to Braze?",
        a: "Nexus calls Braze's REST API directly to send messages. You provide your Braze API key, REST endpoint, and campaign/variant IDs in the Settings page. All sends are attributed to the configured Nexus campaign in Braze so analytics remain unified. Engagement events (opens, conversions) flow back into Nexus via Hightouch to close the learning loop.",
      },
      {
        q: "What data does Nexus need to get started?",
        a: "Nexus needs a TrackedUser record for each person: their Braze external user ID, channel subscription status (push/email enabled), funnel stage (new, growing, lapsed, etc.), and behavioral history like push open rates, email click rates, recency, and giving history. Hightouch syncs this data from your CRM on a regular schedule. Once users are loaded, Nexus can begin learning immediately.",
      },
    ],
  },
  {
    title: "How It Works",
    emoji: "⚙️",
    items: [
      {
        q: "Walk me through exactly what happens when Nexus sends a message",
        a: (
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>Every hour, the cron scans all active Agents for eligible users (subscribed, not over frequency cap, not in quiet hours, active in this send window).</li>
            <li>For each eligible user, it computes a 10-dimensional feature vector from their behavioral history.</li>
            <li>The bandit algorithm scores every message variant against that user&apos;s profile and selects the one most likely to succeed.</li>
            <li>The winning variant is dispatched via Braze&apos;s REST API. The decision is logged: user, variant, channel, timestamp.</li>
            <li>When the user opens the notification, clicks, or converts within 24 hours, the event flows back and updates the variant&apos;s statistics — making it more or less likely to be chosen for similar users in the future.</li>
          </ol>
        ),
      },
      {
        q: "What is a 'bandit algorithm'?",
        a: "A bandit algorithm is a decision-making framework that balances trying new things (exploration) with doing what already works (exploitation). The name comes from the classic 'multi-armed bandit' problem: if you have several slot machines with unknown payouts, how do you find the best one while losing as little money as possible? Nexus solves the same problem with messages: it tries each variant enough to understand its performance, then concentrates sends on the best ones — without waiting for a traditional A/B test to finish.",
      },
      {
        q: "What is Thompson Sampling?",
        a: "Thompson Sampling is the default algorithm Nexus uses. Each message variant maintains a probability distribution (Beta distribution) representing uncertainty about how well it performs. On every selection, Nexus takes a random sample from each variant's distribution. The variant whose sample is highest wins. Crucially, variants we know less about have wider distributions — so they get selected more often early on, naturally exploring the unknown. As data accumulates, the distributions narrow and the best variants win consistently.",
      },
      {
        q: "What is a 'variant' or 'arm'?",
        a: "A variant (also called an arm, from the bandit metaphor) is a single candidate message: a specific title, body, and call-to-action that Nexus can choose to send. Each Agent has multiple variants. Nexus runs experiments across all of them to discover which one drives the best outcome for each user segment. You write the variants; Nexus figures out when to use each one.",
      },
      {
        q: "What does 'exploration vs. exploitation' mean?",
        a: "Exploration means trying variants you haven't fully characterized yet — accepting some short-term risk to gather information. Exploitation means choosing the variant you currently believe is best — maximizing expected return right now. A pure exploit strategy can get stuck on a mediocre winner. Pure exploration wastes sends on known losers. Thompson Sampling automatically balances both: variants with high uncertainty get explored more, and as confidence builds, the best variant naturally dominates.",
      },
      {
        q: "What are Personas and how are they created?",
        a: "Personas are behavioral archetypes — clusters of users who exhibit similar engagement patterns. Nexus runs k-means++ clustering on the 10-dimensional feature vectors of your active user base and discovers 4–9 natural groupings. A 'Weekend Morning Giver' persona behaves very differently from a 'Lapsed Daily Reader' — and the best message variant for one is often wrong for the other. Personas let Nexus maintain separate learned preferences per group, accelerating convergence and improving precision.",
      },
      {
        q: "What is the cron job and how often does it run?",
        a: "The cron runs every hour (configurable). Each run scans all active Agents, identifies eligible users, runs bandit selection, dispatches messages via Braze, and logs decisions. It handles frequency caps (so users aren't over-messaged), quiet hours (so sends respect users' local time preferences), and audience size caps (so Agents don't exceed their configured send volume per period).",
      },
      {
        q: "How does Nexus know if a message 'worked'?",
        a: "Nexus defines 'worked' based on your Agent's Goal. Goals are tiered: a push open earns a modest reward, a donation or in-app conversion earns a larger one. When an engagement event arrives via Hightouch within the 24-hour attribution window, Nexus matches it to the original send decision and applies a reward. Rewards are normalized to [−1, +1] and time-discounted (faster engagement = higher reward). Positive rewards increment α on the winning arm; no conversion increments β — gradually shifting the Beta distribution.",
      },
    ],
  },
  {
    title: "Personalization",
    emoji: "🎯",
    items: [
      {
        q: "What does 'user-level personalization' actually mean?",
        a: "It means Nexus doesn't optimize for the average user — it learns a separate preference model for every individual (via their Persona) and adapts message selection to their specific behavioral fingerprint. A user who engages heavily on Sunday mornings and rarely donates will see different variants than a daily weekday user who converts frequently. The system accumulates evidence about each user's responses and reshapes its beliefs accordingly.",
      },
      {
        q: "What is a feature vector?",
        a: "A feature vector is a compact numeric summary of a user's behavior — a list of 10 numbers that capture everything Nexus needs to characterize who this person is. It's the user's 'behavioral fingerprint.' When Nexus selects a message for someone, it uses their feature vector to find the Persona they belong to, and for LinUCB, as direct context for variant scoring. Feature vectors are recomputed on every ingest.",
      },
      {
        q: "What are the 10 behavioral dimensions in the feature vector?",
        a: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Each user is characterized by exactly 10 signals:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li><strong className="text-foreground">Push open rate</strong> — fraction of push notifications opened</li>
              <li><strong className="text-foreground">Email click rate</strong> — fraction of emails clicked</li>
              <li><strong className="text-foreground">Morning engagement ratio</strong> — share of activity between 6am–12pm</li>
              <li><strong className="text-foreground">Evening engagement ratio</strong> — share of activity between 6pm–10pm</li>
              <li><strong className="text-foreground">Weekend engagement ratio</strong> — share of activity on Sat/Sun</li>
              <li><strong className="text-foreground">Conversion rate</strong> — fraction of sessions that produced a goal event</li>
              <li><strong className="text-foreground">Recency score</strong> — normalized days since last active (1 = today, 0 = 30+ days ago)</li>
              <li><strong className="text-foreground">Giving tier</strong> — normalized lifetime donation history (0 = none, 1 = highest tier)</li>
              <li><strong className="text-foreground">Spiritual depth</strong> — proxy for content engagement depth (plans completed, streaks, etc.)</li>
              <li><strong className="text-foreground">Engagement frequency</strong> — normalized sessions per week over the past month</li>
            </ol>
          </div>
        ),
      },
      {
        q: "What is 'giving tier' and how is it measured?",
        a: "Giving tier reflects a user's lifetime donation history, normalized to a 0–1 scale. It's sourced from your CRM data via Hightouch. Users who have never donated score near 0; your highest-value donors score near 1. This dimension lets Nexus learn, for example, that donation-focused message variants resonate differently with existing givers vs. first-time potential donors.",
      },
      {
        q: "What is 'spiritual depth' and how is it measured?",
        a: "Spiritual depth is a composite proxy for how deeply a user engages with content — typically derived from signals like reading plan completions, streak length, and in-app session quality. It's computed and synced by Hightouch from your CRM. Users with high spiritual depth tend to respond better to substantive, content-rich messages rather than simple open-rate hooks.",
      },
      {
        q: "How does Nexus know when a user engages in the morning vs. evening?",
        a: "Morning, evening, and weekend engagement ratios are computed from the user's historical session timestamps, synced from your CRM analytics. Specifically: what fraction of their total sessions occurred in the 6am–12pm window, the 6pm–10pm window, and on weekends? These ratios are stable behavioral signals — they change slowly over time and are updated on each ingest cycle.",
      },
      {
        q: "Does the feature vector update in real time?",
        a: "Feature vectors update on every Hightouch sync cycle (typically daily or more frequently, depending on your sync schedule). They don't update in real-time on each session event — they're a rolling summary of behavioral history. This is intentional: a stable, representative feature vector is more useful for learning than a noisy one that fluctuates with every single tap.",
      },
      {
        q: "Can I add custom dimensions to the feature vector?",
        a: "The feature vector is currently fixed at 10 dimensions. The specific dimensions were chosen to balance predictive power with computational efficiency for LinUCB's matrix operations (which scale as O(d²)). Adding dimensions would require migrating all existing LinUCBArm matrices. Custom dimensions are not supported in the current version, but contact us if you have a strong use case — we evaluate these requests.",
      },
    ],
  },
  {
    title: "Convergence & Learning",
    emoji: "📈",
    items: [
      {
        q: "How long until Nexus starts working?",
        a: "Nexus starts making decisions from day one — it just starts with high uncertainty and explores freely. You'll typically see measurable improvement in your primary goal metric within 2–4 weeks, and strong convergence (where the best variants are winning consistently) within 6–10 weeks. Timelines depend on send volume: more sends per day means faster learning. The Architecture → Convergence section shows a live projection based on your current pace.",
      },
      {
        q: "What does 'convergence' mean in this context?",
        a: "Convergence means the bandit has accumulated enough evidence that its variant selection has stabilized — it's consistently choosing the statistically best variant and no longer exploring the others significantly. Mathematically, the Beta distributions have narrowed enough that the winning arm's lower confidence bound exceeds the upper confidence bounds of all others. In practice, convergence feels like: sends are concentrating on one or two variants, and your key metric is trending upward and flattening.",
      },
      {
        q: "How many sends does it take to converge?",
        a: "For Thompson Sampling with 3–5 variants: roughly 50–100 sends per arm per Persona is sufficient for reliable convergence — so 200–500 total sends for a 4-variant Agent with a single Persona. With 4 Personas and 4 variants, you're looking at 800–2,000 sends before the system has confident beliefs everywhere. Higher-volume senders converge in days; lower-volume senders may take a few weeks.",
      },
      {
        q: "What happens during the early 'exploration' phase?",
        a: "During exploration, Nexus distributes sends more evenly across all variants. Some sends will go to variants that turn out to be weaker. This is intentional and unavoidable — without exploration, you'd never discover that a variant is good or bad. The cost of exploration is small compared to the long-term gain: a few weeks of slightly suboptimal sends buys months of highly optimized ones. The convergence chart in the Architecture section visualizes this tradeoff.",
      },
      {
        q: "What if one variant is clearly underperforming — does Nexus keep sending it forever?",
        a: "No. As evidence accumulates, Thompson Sampling assigns a narrow, low Beta distribution to underperforming variants. Samples from a narrow low distribution are almost always lower than samples from a wider or higher distribution — so losing arms get selected exponentially less frequently over time. They never reach exactly zero (the bandit always explores a little) but effectively stop competing. You can also manually pause or delete a variant from the Agent settings.",
      },
      {
        q: "What is the difference between Thompson Sampling and LinUCB?",
        a: "Thompson Sampling groups users by Persona and maintains separate Beta(α, β) statistics per variant per Persona. It's fast, robust, and works well when users within a Persona behave similarly. LinUCB (Linear Upper Confidence Bound) uses each user's raw 10-dimensional feature vector directly — it learns a linear model of how context features predict variant reward. LinUCB can capture finer individual differences but requires more data per arm to converge. Use Thompson Sampling to start; consider LinUCB once you have high send volume and want more granular personalization.",
      },
      {
        q: "Does Nexus forget what it learned if I add a new variant?",
        a: "No. Adding a new variant to an existing Agent creates a fresh arm with no prior evidence (α=1, β=1 — a uniform Beta). Existing variants keep all their accumulated statistics. The bandit will explore the new variant until it has enough evidence to compare it confidently against the incumbents. If the new variant is genuinely better, it will naturally take over. If not, it will fade to low selection frequency.",
      },
      {
        q: "How do Personas affect convergence speed?",
        a: "Personas speed up convergence by narrowing the context. Instead of learning a single average preference across all users, Nexus learns a separate preference per behavioral archetype. Users within a Persona are more similar to each other, so each send is more informative. The tradeoff: with more Personas, each arm has fewer sends per Persona, slowing convergence per group. Nexus auto-discovers 4–9 Personas based on natural clustering in your user base — enough granularity to matter without so many that data gets thin.",
      },
    ],
  },
  {
    title: "Performance & Lift",
    emoji: "🚀",
    items: [
      {
        q: "What kind of lift should I expect?",
        a: "Real-world results vary by baseline, send volume, and message quality, but contextual bandit optimization typically delivers 15–40% lift in primary goal metrics (opens, conversions, donations) compared to static best-variant campaigns. The largest gains come from: (1) eliminating consistently weak variants early, (2) matching message tone to Persona preferences, and (3) naturally concentrating sends at times when individual users are most likely to engage.",
      },
      {
        q: "How is lift measured?",
        a: "Nexus measures lift as the improvement in your Agent's goal metric (e.g., push open rate, conversion rate) over time compared to the pre-Nexus baseline or a holdout group. The Performance page shows per-variant and per-Persona trend lines. You can also compare Nexus-selected sends against Braze campaign analytics to see the delta. For rigorous measurement, we recommend running a 10–15% holdout audience that Nexus doesn't optimize — the gap between holdout and optimized cohorts is true incremental lift.",
      },
      {
        q: "What's a realistic timeline to see results?",
        a: "Weeks 1–2: exploration phase — variant distribution is roughly even, performance close to your current baseline. Weeks 3–6: early exploitation — you'll see the best 1–2 variants pulling ahead in the statistics view. Weeks 6–12: convergence — a dominant variant (or small set) emerges per Persona, goal metrics trend upward. Week 12+: stable optimization, incremental gains as user behavior evolves and Nexus adapts.",
      },
      {
        q: "Will Nexus improve both open rates and conversions, or just opens?",
        a: "It depends on your Goal configuration. If your primary Goal is opens, Nexus optimizes for opens. If it's donations or reading plan completions, it optimizes for those — opens are incidental. Goals are tiered: you can weight multiple outcomes (open = small reward, conversion = large reward) so Nexus learns to prioritize deeper engagement over surface-level opens. We recommend setting the Goal to your most valuable downstream action.",
      },
      {
        q: "How does Nexus prevent message fatigue?",
        a: "Three mechanisms: (1) Frequency caps — each Agent has a configurable maximum sends per user per period (daily, weekly). (2) Quiet hours — sends are suppressed during hours you define as off-limits (e.g., 10pm–7am). (3) Natural bandit behavior — as users stop responding to a variant, its reward drops, so Nexus naturally reduces its selection frequency for that user's Persona. Together, these prevent over-messaging without manual tuning.",
      },
      {
        q: "What is a frequency cap?",
        a: "A frequency cap is a hard limit on how many times Nexus can message a single user within a time period. For example, 'no more than 1 push notification per day' or '3 per week.' Users who hit their cap are excluded from the eligibility filter for that Agent until the cap resets. This ensures even highly engaged users aren't spammed, protecting long-term deliverability and trust.",
      },
      {
        q: "Can Nexus optimize send time as well as message content?",
        a: "Yes. Each Agent's Scheduling Rules control which hours of day and days of week the cron will evaluate sends for that Agent. You can configure dual time windows (e.g., 8am–10am and 6pm–8pm) to capture both morning and evening engagement windows. The feature vector includes morning/evening/weekend engagement ratios, so the bandit naturally learns that some Personas respond better to morning sends and adjusts accordingly over time.",
      },
    ],
  },
  {
    title: "Setup & Integration",
    emoji: "🔌",
    items: [
      {
        q: "How does data get into Nexus?",
        a: "Hightouch syncs user data from your CRM (or data warehouse) into Nexus on a configurable schedule. Each sync delivers a batch of user records — each with an external user ID, channel subscription flags, funnel stage, and behavioral attributes. Nexus's ingest endpoint processes these records, updates or creates TrackedUser rows, computes feature vectors, assigns Personas, and updates LinUCB arms for active agents. Everything is automated once the Hightouch sync is configured.",
      },
      {
        q: "How does Hightouch fit in?",
        a: "Hightouch is the data activation layer. It reads from your source of truth (Salesforce, Amplitude, your data warehouse) and pushes structured payloads to Nexus's ingest API. This means Nexus never needs direct access to your production database — Hightouch acts as the bridge, transforming and routing the right fields in the right format. Engagement events (opens, conversions) flow back the same way: from Braze Currents → your warehouse → Hightouch → Nexus.",
      },
      {
        q: "Does Nexus bypass Braze or go through it?",
        a: "Nexus sends through Braze — it calls Braze's REST API to dispatch messages. Users receive messages via Braze's delivery infrastructure, which handles carrier connections, delivery receipts, bounce handling, and unsubscribe compliance. Nexus acts as the intelligence layer on top: deciding who gets which message and when. All sends appear in Braze analytics under the configured Nexus campaign.",
      },
      {
        q: "What Braze permissions does Nexus need?",
        a: "Nexus needs a Braze API key with: (1) Users — send messages permission for dispatching sends; (2) Campaigns — details permission for reading campaign analytics (used for metric reconciliation). The API key, REST endpoint URL, and campaign/variant IDs are configured in Nexus's Settings page. Nexus never stores Braze user PII — it only needs the external user ID for routing.",
      },
      {
        q: "How do I create my first Agent?",
        a: (
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>Go to Agents → New Agent and fill in the name, channel, and algorithm (start with Thompson Sampling).</li>
            <li>Add message variants — write 3–5 different versions of your message with distinct tones or calls-to-action.</li>
            <li>Set a Goal — choose the engagement event you want to optimize for (opens, donations, plan completions).</li>
            <li>Configure frequency caps and quiet hours in the Scheduling tab.</li>
            <li>Set target Personas (or leave as &quot;all&quot; to learn across your full base).</li>
            <li>Activate the Agent — it will begin selecting and sending on the next cron cycle.</li>
          </ol>
        ),
      },
      {
        q: "What are Agents and Goals?",
        a: "An Agent is a named optimization campaign — the 'what and who': a set of message variants, a target channel, a goal to optimize, frequency rules, and eligible audience. A Goal is the outcome you want each send to produce: an open, a donation, a reading plan start, a conversion. Goals have tiers — more valuable outcomes carry higher rewards, so the bandit learns to prefer variants that drive deeper actions over superficial opens.",
      },
    ],
  },
  {
    title: "Technical Details",
    emoji: "🔬",
    items: [
      {
        q: "What is LinUCB and when should I use it?",
        a: "LinUCB (Linear Upper Confidence Bound) is a contextual bandit algorithm that uses the full feature vector as input. For each variant, it maintains an inverse design matrix (A⁻¹) and a reward vector (b) — updated via Sherman-Morrison rank-1 updates on each reward. It scores variants as θᵀx + α√(xᵀA⁻¹x), where the second term is the exploration bonus for uncertain directions. Use LinUCB when you have high send volume (1000+ sends/day) and want finer individual personalization beyond Persona-level. Thompson Sampling is simpler and converges faster at lower volumes.",
      },
      {
        q: "How does the Persona clustering algorithm work?",
        a: "Nexus runs k-means++ on a sample of up to 1,000 active user feature vectors, testing k=4 through k=9 clusters. For each k, it computes the silhouette score — a measure of how well-separated the clusters are. The k with the highest silhouette score (above a minimum threshold of 0.2) is selected. If no k passes the threshold (or k=1 is optimal), Nexus uses a single 'default' Persona. Personas are re-clustered periodically as user behavior evolves.",
      },
      {
        q: "What does the Control Tower do?",
        a: "The Control Tower is the AI-powered optimization command center. It surfaces cross-agent insights: which Agents have converged, which variants are underperforming across the fleet, whether Persona distributions are drifting, and where intervention opportunities exist. It's designed for platform-level visibility — instead of checking each Agent individually, the Control Tower gives you a single view of where learning is healthy and where it needs attention.",
      },
      {
        q: "How is the reward signal calculated?",
        a: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Rewards are computed from matched engagement events within the 24-hour attribution window:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-foreground">Goal tier weight</strong>: Higher-tier events (donation, completion) earn higher base rewards than lower-tier events (open)</li>
              <li><strong className="text-foreground">Time discount</strong>: Engagement within 1 hour = 1.0×; within 24 hours = decays to ~0.5× (exponential decay)</li>
              <li><strong className="text-foreground">Normalization</strong>: Final reward is normalized to [−1, +1]</li>
            </ul>
            <p>Positive reward increments α on the winning arm&apos;s Beta distribution; no conversion increments β. This shifts the mean (α/(α+β)) and narrows uncertainty over time.</p>
          </div>
        ),
      },
      {
        q: "Is my data used to train a shared model across customers?",
        a: "No. Every Nexus deployment is fully isolated. LinUCBArm matrices, PersonaArmStats, Personas, and all learned state are scoped to your Agents and your users exclusively. There is no cross-customer model sharing, no federated learning, and no data leaves your Nexus instance. Your engagement patterns and user behavioral data are never used to improve any other organization's model.",
      },
    ],
  },
];

export default function FaqPage() {
  const totalQuestions = FAQ_CATEGORIES.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <>
      <Header
        title="FAQ"
        description="Everything you need to know about Nexus"
      />
      <div className="p-4 sm:p-6 max-w-3xl space-y-6">

        {/* Intro */}
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {totalQuestions} questions across {FAQ_CATEGORIES.length} topics — from first-time setup to the math behind convergence.
          </p>
        </div>

        {/* Accordion */}
        <FaqAccordion categories={FAQ_CATEGORIES} />

      </div>
    </>
  );
}
