/**
 * Fills the public demo DB (nexus-demo-db) with synthetic agents, variants,
 * users and six weeks of decisions so the console has something to show.
 * No YouVersion content. Idempotent: first deletes its own rows: users and decisions with the "demo-"
 * prefix, and agents named with the "[Demo] " prefix (cascades to their messages and variants).
 *
 *   DEMO_DATABASE_URL='postgresql://…ep-orange-star-b8ujtvot…' bun scripts/seed-demo-synthetic.ts
 */
import { assertDemoDatabase } from "./lib/demo-db-guard";
import { mulberry32 } from "../apps/site/lib/simulator/rng";

const url = assertDemoDatabase(process.env.DEMO_DATABASE_URL);
process.env.DATABASE_URL = url; // must be set before @/lib/db is imported
const { prisma } = await import("../src/lib/db");

const rng = mulberry32(2026);
const DAYS = 42;
const USERS = 2000;
const PREFIX = "demo-";
const AGENT_PREFIX = "[Demo] ";

const AGENTS = [
  { name: `${AGENT_PREFIX}Win-back push`, algorithm: "thompson", channel: "push", rates: [0.021, 0.034, 0.028, 0.046] },
  { name: `${AGENT_PREFIX}Onboarding email`, algorithm: "epsilon_greedy", channel: "email", rates: [0.12, 0.18, 0.14, 0.15] },
  { name: `${AGENT_PREFIX}Upsell (contextual)`, algorithm: "linucb", channel: "push", rates: [0.05, 0.08, 0.03, 0.06] },
  { name: `${AGENT_PREFIX}Re-engagement with holdout`, algorithm: "thompson", channel: "push", rates: [0.03, 0.04, 0.035] },
];
const COPY = ["Pick up where you left off.", "Others finished this week — join them.", "A quick win is waiting.", "Your progress, at a glance."];

async function main() {
  await prisma.userDecision.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: AGENT_PREFIX } } });
  await prisma.trackedUser.deleteMany({ where: { externalId: { startsWith: PREFIX } } });

  const personas = await prisma.persona.findMany({ select: { id: true } });
  if (personas.length === 0) throw new Error("Seed personas first: DATABASE_URL=<demo> bun prisma/seed-personas.ts");

  await prisma.trackedUser.createMany({
    data: Array.from({ length: USERS }, (_, i) => ({
      externalId: `${PREFIX}user-${i + 1}`,
      personaId: personas[Math.floor(rng() * personas.length)]!.id,
      personaConfidence: 1,
      attributes: { language_tag: "en", newsletter_push_enabled: true, newsletter_email_enabled: true },
    })),
  });

  const start = new Date(Date.now() - DAYS * 86_400_000);
  for (const a of AGENTS) {
    const agent = await prisma.agent.create({ data: { name: a.name, algorithm: a.algorithm, epsilon: 0.1, status: "active", funnelStage: "wau" } });
    const message = await prisma.message.create({ data: { agentId: agent.id, name: `${a.name} message`, channel: a.channel } });
    const variants = await Promise.all(a.rates.map((_, i) =>
      prisma.messageVariant.create({ data: { messageId: message.id, name: `Variant ${String.fromCharCode(65 + i)}`, body: COPY[i % COPY.length]!, title: a.name, status: "active" } })));

    // Traffic drifts toward the best variant over time, as a bandit would.
    const best = a.rates.indexOf(Math.max(...a.rates));
    const rows = [];
    for (let d = 0; d < DAYS; d++) {
      const bestShare = 0.25 + 0.65 * (d / DAYS);
      for (let k = 0; k < 120; k++) {
        const v = rng() < bestShare ? best : Math.floor(rng() * variants.length);
        const sentAt = new Date(start.getTime() + d * 86_400_000 + Math.floor(rng() * 86_400_000));
        const converted = rng() < a.rates[v]!;
        rows.push({
          agentId: agent.id,
          userId: `${PREFIX}user-${1 + Math.floor(rng() * USERS)}`,
          messageVariantId: variants[v]!.id,
          channel: a.channel,
          sentAt,
          brazeSendId: `${PREFIX}send-${agent.id}-${d}-${k}`,
          ...(converted ? { conversionEvent: "goal_completed", conversionAt: new Date(sentAt.getTime() + 3_600_000), reward: 1 } : {}),
        });
      }
    }
    await prisma.userDecision.createMany({ data: rows });
    console.log(`seeded ${a.name}: ${rows.length} decisions`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1); });
