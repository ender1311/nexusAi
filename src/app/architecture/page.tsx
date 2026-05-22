import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";

const STEPS = [
  {
    num: 1,
    title: "User Data Sync",
    description:
      "Hightouch syncs behavioral data from your CRM into Nexus on a regular schedule. Each user's channel subscriptions, last-seen timestamp, funnel stage, and engagement history land in a TrackedUser record in the database.",
  },
  {
    num: 2,
    title: "Feature Vector Extraction",
    description:
      "10 behavioral signals are distilled per user into a compact numeric vector: push open rate, email click rate, morning/evening/weekend engagement ratios, conversion rate, recency, giving tier, spiritual depth, and engagement frequency.",
  },
  {
    num: 3,
    title: "Persona Assignment",
    description:
      "k-means++ clustering groups similar feature vectors into 4–9 behavioral archetypes called Personas. Each user is matched to their nearest centroid at ingest time. Personas are periodically re-clustered as behavior evolves.",
  },
  {
    num: 4,
    title: "Agent & Variant Setup",
    description:
      "Agents define the \"what\" and \"who\": message variants (the bandit arms), target personas, frequency caps, quiet hours, and audience size. Each variant is a candidate message the system can select for any given user.",
  },
  {
    num: 5,
    title: "Hourly Eligibility Check",
    description:
      "Every hour the cron scans active agents and filters users who are eligible right now: channel subscription active, frequency cap not exhausted, not inside quiet hours, last-seen time matching the current send window, and within audience cap.",
  },
  {
    num: 6,
    title: "Bandit Arm Selection",
    description:
      "For each eligible user, Nexus looks up their persona and draws a random sample from the Beta(α, β) distribution of each message variant within that persona. The variant whose sample is highest wins — consistently high-performing variants win more draws over time.",
  },
  {
    num: 7,
    title: "Send via Braze",
    description:
      "The winning variant is dispatched to Braze's REST API as a push notification (or email / in-app message). The decision is logged: user, variant, channel, scheduled timestamp — ready for reward matching when engagement arrives.",
  },
  {
    num: 8,
    title: "Engagement Observation",
    description:
      "When the user opens the notification, clicks a link, or converts, the event flows back through Hightouch → Nexus's ingest endpoint. The event is matched to the logged decision by external user ID within a 24-hour attribution window.",
  },
  {
    num: 9,
    title: "Reward Calculation",
    description:
      "The matched event triggers a reward: tiered by goal type (reading plan completion > donation > open), normalized to [−1, +1], and time-discounted by how quickly the user engaged. A positive reward increments α on the winning arm; no conversion increments β.",
  },
  {
    num: 10,
    title: "The Loop Tightens",
    description:
      "Updated Beta distributions mean the best-performing variants get higher expected samples in future rounds. Over thousands of sends the system continuously sharpens — more personalized, more precise, more effective with every cycle.",
  },
];

export default function ArchitecturePage() {
  return (
    <>
      <Header title="Architecture" description="How Nexus makes a decision" />
      <div className="p-4 sm:p-6 max-w-5xl space-y-8">

        {/* Intro */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Nexus is a contextual multi-armed bandit system. Every hour it selects
            the best message variant for each eligible user, learns from the
            resulting engagement, and gets a little smarter. The ten steps below
            trace exactly how that happens — from raw CRM data to an adaptive
            feedback loop.
          </p>
          <div className="rounded-lg border-l-4 border-l-[#57a16c] bg-muted/30 p-4 max-w-2xl">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Want the full math? The{" "}
              <Link href="/demo/deep-dive" className="text-[#57a16c] font-medium hover:underline">
                Advanced Data Science docs
              </Link>{" "}
              cover feature vectors, persona clustering, bandit algorithms, reward
              calculus, lift measurement, and send-time optimization in detail.
            </p>
          </div>
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {STEPS.map((step) => (
            <Card
              key={step.num}
              className="border bg-card hover:border-[#57a16c]/40 transition-colors"
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-[#57a16c]/15 text-[#57a16c] text-xs font-bold shrink-0 mt-0.5">
                    {step.num}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-snug mb-1.5">
                      {step.title}
                    </p>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Convergence timeline */}
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-1">How long until the bandit converges?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Convergence means the Beta distributions have narrowed enough that the best-performing
              variant wins draws consistently — typically after ~30–50 observations per arm. Speed
              depends on two things: how many users are in the target persona, and how often each
              user is eligible to receive a send. Funnel stage drives eligibility frequency.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse max-w-2xl">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Funnel stage</th>
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Eligibility</th>
                  <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Sends / user / month</th>
                  <th className="text-left py-2 font-semibold text-muted-foreground">Convergence (1 k users, 3 arms)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-2 pr-4 font-medium">DAU4</td>
                  <td className="py-2 pr-4 text-muted-foreground">Daily</td>
                  <td className="py-2 pr-4 text-muted-foreground">~20–30</td>
                  <td className="py-2 text-[#57a16c] font-medium">Days</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">WAU</td>
                  <td className="py-2 pr-4 text-muted-foreground">1–3×/week</td>
                  <td className="py-2 pr-4 text-muted-foreground">~6–12</td>
                  <td className="py-2 text-muted-foreground font-medium">1–3 weeks</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">MAU</td>
                  <td className="py-2 pr-4 text-muted-foreground">~1×/month</td>
                  <td className="py-2 pr-4 text-muted-foreground">~1–2</td>
                  <td className="py-2 text-muted-foreground font-medium">2–4 months</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Lapsed</td>
                  <td className="py-2 pr-4 text-muted-foreground">Rarely / re-engagement burst</td>
                  <td className="py-2 pr-4 text-muted-foreground">&lt;1</td>
                  <td className="py-2 text-muted-foreground font-medium">Many months</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border-l-4 border-l-amber-500 bg-muted/30 p-4 max-w-2xl">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Practical implication:</span> for lapsed
              and MAU audiences, keep variant count low (2–3) to reach exploitation faster. More
              variants dilute observations per arm and slow convergence. For DAU4 agents with large
              audiences, you can run 4–6 arms and still converge within a sprint.
            </p>
          </div>
        </div>

        {/* Advanced docs link */}
        <div className="pt-2 border-t">
          <Link
            href="/demo/deep-dive"
            className="inline-flex items-center gap-2 text-sm text-[#57a16c] font-medium hover:underline"
          >
            <BookOpen className="h-4 w-4" />
            Advanced Data Science — full technical deep-dive
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

      </div>
    </>
  );
}
