/**
 * Seed script: Retention Agent + 4 Message Variants
 *
 * Creates:
 * 1. Agent "Retention: Habit Builder" (Thompson Sampling, draft)
 * 2. Message "Retention Push" with 4 variants targeting active readers
 * 3. AgentPersonaTarget for Active Readers + Weekly Readers personas
 * 4. PersonaArmStats seeded at Beta(1,30) pessimistic prior
 *
 * Usage: bun run scripts/seed-retention-agent.ts
 */

import { prisma } from "../src/lib/db";

const VARIANTS = [
  {
    name: "A — Streak",
    title: "Don't break your streak 🔥",
    body: "Keep your reading streak alive today.",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: {
      tone: "urgency",
      hasPersonalization: false,
      ctaType: "deeplink",
      messageLengthBucket: "short",
    },
  },
  {
    name: "B — Plan Nudge",
    title: "Your reading plan is waiting ➡️",
    body: "Pick up where you left off in God's Word.",
    deeplink: "youversion://bible",
    cta: "Continue Plan",
    actionFeatures: {
      tone: "empathy",
      hasPersonalization: false,
      ctaType: "deeplink",
      messageLengthBucket: "short",
    },
  },
  {
    name: "C — Habit",
    title: "📖 You're building a habit",
    body: "Consistent time in God's Word changes everything.",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: {
      tone: "empathy",
      hasPersonalization: false,
      ctaType: "deeplink",
      messageLengthBucket: "short",
    },
  },
  {
    name: "D — Plan (personalized)",
    title: "{{${first_name} | default: 'Friend'}}, your plan is waiting",
    body: "Jump back into your reading plan today ➡️",
    deeplink: "youversion://bible",
    cta: "Continue Plan",
    actionFeatures: {
      tone: "question",
      hasPersonalization: true,
      ctaType: "deeplink",
      messageLengthBucket: "short",
    },
  },
];

async function main() {
  console.log("🌱 Seeding retention agent...\n");

  // Find target personas
  const activeReaders = await prisma.persona.findFirst({ where: { name: "Active Readers" } });
  const weeklyReaders = await prisma.persona.findFirst({ where: { name: "Weekly Readers" } });
  const targetPersonas = [activeReaders, weeklyReaders].filter(Boolean) as { id: string; name: string }[];
  console.log(`Found ${targetPersonas.length} target personas: ${targetPersonas.map((p) => p.name).join(", ")}`);

  // Create agent
  let agent = await prisma.agent.findFirst({ where: { name: "Retention: Habit Builder" } });
  if (agent) {
    console.log(`  ✓ Agent already exists (${agent.id})`);
  } else {
    agent = await prisma.agent.create({
      data: {
        name: "Retention: Habit Builder",
        description: "Keeps active and weekly readers engaged by reinforcing daily reading habits. Uses Thompson Sampling to find which message drives the most plan continuations.",
        algorithm: "thompson",
        epsilon: 0.1,
        status: "draft",
        goals: {
          create: [
            {
              eventName: "app_open",
              tier: "primary",
              valueWeight: 1.0,
              description: "User opens the Bible App after receiving push",
            },
            {
              eventName: "plan_read_day_3",
              tier: "secondary",
              valueWeight: 2.0,
              description: "User completes day 3 of a plan — habit forming",
            },
            {
              eventName: "plan_read_day_7",
              tier: "secondary",
              valueWeight: 3.0,
              description: "User completes day 7 of a plan — sustained habit",
            },
          ],
        },
        schedulingRule: {
          create: {
            frequencyCap: { maxSends: 1, period: "week" },
            quietHours: { start: "22:00", end: "08:00", timezone: "America/New_York" },
            smartSuppress: true,
            suppressThresh: 0.3,
          },
        },
      },
    });
    console.log(`  + Created agent "${agent.name}" (${agent.id})`);
  }

  // Create message + variants
  let message = await prisma.message.findFirst({ where: { agentId: agent.id, name: "Retention Push" } });
  if (message) {
    console.log(`  ✓ Message already exists (${message.id})`);
  } else {
    message = await prisma.message.create({
      data: {
        agentId: agent.id,
        name: "Retention Push",
        channel: "push",
        testedVariables: ["title", "body"],
        variants: {
          create: VARIANTS.map((v) => ({
            name: v.name,
            title: v.title,
            body: v.body,
            deeplink: v.deeplink,
            cta: v.cta,
            status: "active",
            actionFeatures: v.actionFeatures,
          })),
        },
      },
      include: { variants: true },
    });
    console.log(`  + Created message "Retention Push" (${message.id})`);
    for (const v of (message as typeof message & { variants: { id: string; name: string }[] }).variants) {
      console.log(`    + Variant: ${v.name} (${v.id})`);
    }
  }

  // Wire persona targets
  for (const persona of targetPersonas) {
    const existing = await prisma.agentPersonaTarget.findUnique({
      where: { agentId_personaId: { agentId: agent.id, personaId: persona.id } },
    });
    if (!existing) {
      await prisma.agentPersonaTarget.create({ data: { agentId: agent.id, personaId: persona.id } });
      console.log(`  + Linked persona "${persona.name}"`);
    } else {
      console.log(`  ✓ Persona "${persona.name}" already linked`);
    }
  }

  // Seed PersonaArmStats at Beta(1,30)
  const variants = await prisma.messageVariant.findMany({
    where: { messageId: message.id },
    select: { id: true, name: true },
  });

  let seeded = 0;
  for (const persona of targetPersonas) {
    for (const variant of variants) {
      const existing = await prisma.personaArmStats.findUnique({
        where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
      });
      if (!existing) {
        await prisma.personaArmStats.create({
          data: { personaId: persona.id, agentId: agent.id, variantId: variant.id, alpha: 1.0, beta: 30.0, tries: 0, wins: 0 },
        });
        seeded++;
      }
    }
  }
  console.log(`  + Seeded ${seeded} arm stats (${targetPersonas.length} personas × ${variants.length} variants)`);

  console.log("\n✅ Done!");
  console.log(`Agent ID: ${agent.id}`);
  console.log(`Message ID: ${message.id}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
