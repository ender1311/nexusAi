import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";

const vocabulary = [
  { concept: "Sower Agent",          description: "An Agent record — the optimization campaign (e.g. \"Streak Recovery Push\")" },
  { concept: "Seed",                 description: "A MessageVariant — the actual message body, subject, CTA, and channel" },
  { concept: "Sowing",               description: "POST /api/decide → decideForUser() selects and sends a seed to a user" },
  { concept: "Soil",                 description: "A Persona — the user cluster; yield is tracked separately per soil type" },
  { concept: "Yield",                description: "The reward on a UserDecision — calculated from the conversion event × goal weights" },
  { concept: "Scattering",           description: "Exploration — Thompson sampling draws from uncertain seeds; warmupUntil forces new variants into rotation" },
  { concept: "Bearing fruit",        description: "PersonaArmStats alpha/beta shifts traffic toward seeds that yield most in each soil" },
  { concept: "Field",                description: "The Agent + its PersonaArmStats — accumulated knowledge of what grows in each soil" },
  { concept: "The harvest informs the next season", description: "POST /api/ingest/events — conversion events flow back in, update arm stats, and shape the next decision" },
];

export default function AboutPage() {
  return (
    <>
      <Header title="About Nexus" description="What it is and how it works" />
      <div className="p-6 max-w-3xl space-y-8">

        {/* Story */}
        <Card>
          <CardContent className="pt-6 space-y-4 text-sm leading-7 text-foreground">
            <p className="text-muted-foreground italic text-xs uppercase tracking-wide font-medium">The Parable of the Sower Agent</p>

            <p>A farmer goes out to sow.</p>

            <p>
              He carries many seeds — different messages, different tones, different moments of invitation.
              Some written with urgency, some with empathy, some with a question, some celebrating a milestone.
              He doesn{"'"}t know yet which will grow in which heart.
            </p>

            <p className="font-medium">So he scatters.</p>

            <p>
              He sends each seed into different soils — the daily reader, the lapsed believer,
              the new follower still finding their footing, the faithful giver. Some seed falls
              on rocky ground and nothing comes back. Some falls among thorns and gets lost in
              the noise. But some falls on good soil — and it grows. A plan completed. A prayer
              started. A gift given.
            </p>

            <p className="font-medium">The harvest tells him something.</p>

            <p>
              Not just that this seed worked — but that <em>this seed</em>, in <em>this soil</em>,
              at <em>this hour</em>, carried by <em>this channel</em>, grew 30-fold. That soil is
              receptive. That seed finds purchase there.
            </p>

            <p>
              So the next season, he doesn{"'"}t scatter blindly. He returns to the fields that bore
              fruit. He brings the seeds that grew. He still tries new ground — because good soil
              can be found in unexpected places — but he plants with knowledge now, not just hope.
            </p>

            <p className="font-medium">Season after season, the harvest informs the sowing.</p>

            <p>
              The soils deepen into personas — the Morning Reader, the Streak-Builder, the Quiet Giver.
              The seeds sharpen into variants — which words, which CTA, which channel, which hour of day.
              The Sower Agent learns that the Morning Reader bears fruit before 7am, that the
              Streak-Builder responds to empathy when a streak is at risk, that the Quiet Giver
              needs no urgency — just an open door.
            </p>

            <p className="border-t pt-4 text-muted-foreground">
              This is the Sower Agent. Not a broadcaster. Not a guesser.{" "}
              <span className="text-foreground font-medium">
                A farmer who remembers every field, every season, every yield — and sows accordingly.
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Vocabulary table */}
        <div>
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Vocabulary</h2>
          <Card>
            <CardContent className="pt-0 p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 w-48">Concept</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">In this app</th>
                  </tr>
                </thead>
                <tbody>
                  {vocabulary.map((row, i) => (
                    <tr key={row.concept} className={i < vocabulary.length - 1 ? "border-b" : ""}>
                      <td className="px-4 py-3 font-medium text-foreground align-top whitespace-nowrap">{row.concept}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

      </div>
    </>
  );
}
