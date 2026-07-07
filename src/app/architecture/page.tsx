import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleVideos } from "@/components/architecture/collapsible-videos";
import { NexusVideoPlayer } from "@/components/video/nexus-video-player";
import { DecisioningLoop } from "@/components/architecture/decisioning-loop";
import { ConvergenceSection } from "./convergence-section";
import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";

const THOMPSON_VIDEOS = [
  { id: "vz3D36VXefI", title: "Thompson Sampling Explained" },
  { id: "nkyDGGQ5h60", title: "Multi-Armed Bandit Intuition" },
  { id: "Zgwfw3bzSmQ", title: "Beta Distribution & Exploration" },
];


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

        {/* Animated decisioning-loop diagram */}
        <DecisioningLoop />

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

        {/* Walkthrough video */}
        <div className="space-y-3">
          <p className="text-[11px] font-mono tracking-widest uppercase text-[#57a16c] font-semibold">
            Watch the walkthrough
          </p>
          <NexusVideoPlayer
            basePath="/videos/nexus-architecture"
            lengths={[
              { key: "1min", label: "1 min" },
              { key: "5min", label: "5 min" },
            ]}
            defaultLength="1min"
            defaultVoice="michael"
            accent="#57a16c"
            className="w-full sm:max-w-[70%]"
          />
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
        <ConvergenceSection />

        {/* Thompson Sampling videos */}
        <div className="pt-2 border-t">
          <CollapsibleVideos
            heading="Thompson Sampling — further reading"
            videos={THOMPSON_VIDEOS}
          />
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
