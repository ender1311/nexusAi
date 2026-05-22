/**
 * Seed script: Re-engagement Agent + 4 Message Variants
 *
 * Creates:
 * 1. 3 personas segmented by recency (lapsed / weekly / active)
 * 2. Re-engagement agent (Thompson Sampling)
 * 3. Message with 4 push variants (MAU→DAU copy from docs/push-copy-inventory.md)
 * 4. Scheduling rule (1×/week, quiet hours 22:00–08:00 ET)
 * 5. AgentPersonaTarget entries for all 3 personas
 * 6. PersonaArmStats seeded at Beta(1,30) pessimistic prior
 * 7. User → persona assignment based on days_since_last_open attribute
 *
 * After running: set brazeCampaignId and brazeVariantIds via the Settings UI
 * or by running: bun run scripts/set-braze-ids.ts
 *
 * Usage: bun run scripts/seed-reengagement-agent.ts
 */

import { prisma } from "../src/lib/db";

// ─── Persona definitions ────────────────────────────────────────────────────

const PERSONAS = [
  {
    name: "Lapsed Readers",
    description: "Users who haven't opened in 30+ days. Highest priority for re-engagement.",
    icon: "Users2",
    color: "red",
    tags: ["lapsed", "re-engagement"],
    minDays: 30,
    maxDays: Infinity,
  },
  {
    name: "Weekly Readers",
    description: "Users who opened 7–30 days ago. Occasional users, habit not yet formed.",
    icon: "Users2",
    color: "yellow",
    tags: ["weekly", "re-engagement"],
    minDays: 7,
    maxDays: 29,
  },
  {
    name: "Active Readers",
    description: "Users who opened within the last 7 days. Recently active — reinforce habit.",
    icon: "Users2",
    color: "green",
    tags: ["active"],
    minDays: 0,
    maxDays: 6,
  },
] as const;

// ─── Push message variants ────────────────────────────────────────────────────
// From docs/push-copy-inventory.md — MAU→DAU workflow, English

const VARIANTS = [
  {
    name: "A — Consistency",
    title: "Growth is not about perfection…",
    body: "It's about consistency ➡️",
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
    name: "B — Listen to God",
    title: "👂 Listen to God today",
    body: "Reflect on the Verse of the Day ➡️",
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
    name: "C — Guided Prayer",
    title: "⏸️ Pause with God",
    body: "Spend time with God in Guided Prayer.",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    actionFeatures: {
      tone: "question",
      hasPersonalization: false,
      ctaType: "deeplink",
      messageLengthBucket: "short",
    },
  },
  {
    name: "D — Next Step (personalized)",
    title: "{{${first_name} | default: ''}}, what's your next step?",
    body: "Open your Bible App today!",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: {
      tone: "question",
      hasPersonalization: true,
      ctaType: "deeplink",
      messageLengthBucket: "short",
    },
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding re-engagement agent...\n");

  // 1. Create personas
  console.log("Creating personas...");
  const createdPersonas: { id: string; name: string; minDays: number; maxDays: number }[] = [];

  for (const p of PERSONAS) {
    const existing = await prisma.persona.findFirst({ where: { name: p.name } });
    if (existing) {
      console.log(`  ✓ Persona "${p.name}" already exists (${existing.id})`);
      createdPersonas.push({ id: existing.id, name: p.name, minDays: p.minDays, maxDays: p.maxDays });
      continue;
    }
    const persona = await prisma.persona.create({
      data: {
        name: p.name,
        description: p.description,
        icon: p.icon,
        color: p.color,
        tags: p.tags,
        source: "manual",
        isActive: true,
      },
    });
    createdPersonas.push({ id: persona.id, name: p.name, minDays: p.minDays, maxDays: p.maxDays });
    console.log(`  + Created persona "${p.name}" (${persona.id})`);
  }

  // 2. Assign users to personas based on days_since_last_open
  console.log("\nAssigning users to personas...");
  const allUsers = await prisma.trackedUser.findMany({
    select: { id: true, externalId: true, attributes: true, personaId: true },
  });

  let assigned = 0;
  let skipped = 0;

  for (const user of allUsers) {
    const attrs = (user.attributes ?? {}) as Record<string, unknown>;
    const daysSince = typeof attrs["days_since_last_open"] === "number"
      ? (attrs["days_since_last_open"] as number)
      : null;

    // No days_since_last_open → treat as lapsed (attribute only populated for recent openers)
    const lapsedPersona = createdPersonas.find((p) => p.minDays === 30);

    const persona = daysSince === null
      ? lapsedPersona
      : createdPersonas.find((p) => daysSince >= p.minDays && daysSince <= p.maxDays);

    if (!persona) {
      skipped++;
      continue;
    }

    if (user.personaId === persona.id) {
      continue; // already correctly assigned
    }

    await prisma.trackedUser.update({
      where: { id: user.id },
      data: {
        personaId: persona.id,
        personaConfidence: 0.9,
        personaAssignedAt: new Date(),
      },
    });
    assigned++;
  }

  // Update cluster sizes
  for (const p of createdPersonas) {
    const count = await prisma.trackedUser.count({ where: { personaId: p.id } });
    await prisma.persona.update({ where: { id: p.id }, data: { clusterSize: count } });
    console.log(`  • "${p.name}" — ${count} users assigned`);
  }
  console.log(`  → ${assigned} assigned, ${skipped} skipped (no days_since_last_open)`);

  // 3. Create the re-engagement agent
  console.log("\nCreating agent...");
  let agent = await prisma.agent.findFirst({ where: { name: "Re-engagement: Daily Reader" } });

  if (agent) {
    console.log(`  ✓ Agent already exists (${agent.id})`);
  } else {
    agent = await prisma.agent.create({
      data: {
        name: "Re-engagement: Daily Reader",
        description: "Converts lapsed and occasional users into daily Bible readers. Uses Thompson Sampling to discover which push message resonates best per persona.",
        algorithm: "thompson",
        epsilon: 0.1,
        status: "draft", // Set to "active" after wiring Braze campaign IDs
        goals: {
          create: [
            {
              eventName: "app_open",
              tier: "primary",
              valueWeight: 1.0,
              description: "User opens the Bible App after receiving push",
            },
            {
              eventName: "plan_started",
              tier: "secondary",
              valueWeight: 2.0,
              description: "User starts a reading plan — stronger habit signal",
            },
            {
              eventName: "plan_read_day_3",
              tier: "secondary",
              valueWeight: 3.0,
              description: "User completes day 3 of a plan — sustained engagement",
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

  // 4. Create message + 4 variants
  console.log("\nCreating message + variants...");
  let message = await prisma.message.findFirst({ where: { agentId: agent.id, name: "Re-engagement Push" } });

  if (message) {
    console.log(`  ✓ Message already exists (${message.id})`);
    const existingVariants = await prisma.messageVariant.findMany({ where: { messageId: message.id } });
    console.log(`    ${existingVariants.length} variants already created`);
  } else {
    message = await prisma.message.create({
      data: {
        agentId: agent.id,
        name: "Re-engagement Push",
        channel: "push",
        // brazeCampaignId: — set after Braze campaign is created
        testedVariables: ["title", "body", "deeplink"],
        variants: {
          create: VARIANTS.map((v) => ({
            name: v.name,
            title: v.title,
            body: v.body,
            deeplink: v.deeplink,
            cta: v.cta,
            status: "active",
            actionFeatures: v.actionFeatures,
            // brazeVariantId: — set after Braze campaign is created
            // warmupUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // optional warmup
          })),
        },
      },
      include: { variants: true },
    });
    console.log(`  + Created message "Re-engagement Push" (${message.id})`);
    for (const v of (message as typeof message & { variants: { id: string; name: string }[] }).variants) {
      console.log(`    + Variant: ${v.name} (${v.id})`);
    }
  }

  // 5. Wire persona targets
  console.log("\nWiring persona targets...");
  for (const persona of createdPersonas) {
    const existing = await prisma.agentPersonaTarget.findUnique({
      where: { agentId_personaId: { agentId: agent.id, personaId: persona.id } },
    });
    if (existing) {
      console.log(`  ✓ Target "${persona.name}" already exists`);
      continue;
    }
    await prisma.agentPersonaTarget.create({ data: { agentId: agent.id, personaId: persona.id } });
    console.log(`  + Linked persona "${persona.name}"`);
  }

  // 6. Seed PersonaArmStats at Beta(1,30) pessimistic prior
  console.log("\nSeeding PersonaArmStats (Beta(1,30) prior)...");
  const variants = await prisma.messageVariant.findMany({
    where: { messageId: message.id },
    select: { id: true, name: true },
  });

  let statsSeeded = 0;
  for (const persona of createdPersonas) {
    for (const variant of variants) {
      const existing = await prisma.personaArmStats.findUnique({
        where: {
          personaId_agentId_variantId: {
            personaId: persona.id,
            agentId: agent.id,
            variantId: variant.id,
          },
        },
      });
      if (!existing) {
        await prisma.personaArmStats.create({
          data: {
            personaId: persona.id,
            agentId: agent.id,
            variantId: variant.id,
            alpha: 1.0,
            beta: 30.0,
            tries: 0,
            wins: 0,
          },
        });
        statsSeeded++;
      }
    }
  }
  console.log(`  + Seeded ${statsSeeded} arm stats (${createdPersonas.length} personas × ${variants.length} variants)`);

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log("\n✅ Done!\n");
  console.log("═══ Next Steps ═══════════════════════════════════════════════");
  console.log("");
  console.log("1. Create a Braze API campaign:");
  console.log("   - Type: API Campaign");
  console.log("   - Channel: Push Notification (iOS + Android)");
  console.log("   - Create 4 message variations (A, B, C, D)");
  console.log("   - Copy the campaign ID and each variant ID");
  console.log("");
  console.log(`2. Set Braze IDs on the Message (${message.id}):`);
  console.log("   UPDATE \"Message\" SET \"brazeCampaignId\" = '<BRAZE_CAMPAIGN_ID>'");
  console.log(`   WHERE id = '${message.id}';`);
  console.log("");
  const allVariants = await prisma.messageVariant.findMany({
    where: { messageId: message.id },
    select: { id: true, name: true },
  });
  console.log("   For each variant, set brazeVariantId:");
  for (const v of allVariants) {
    console.log(`   UPDATE \"MessageVariant\" SET \"brazeVariantId\" = '<VARIANT_ID>' WHERE id = '${v.id}'; -- ${v.name}`);
  }
  console.log("");
  console.log(`3. Activate the agent:`);
  console.log(`   UPDATE "Agent" SET status = 'active' WHERE id = '${agent.id}';`);
  console.log("");
  console.log("   Or use: bun run scripts/activate-agent.ts");
  console.log("");
  console.log("4. Test send:");
  console.log(`   curl -X POST https://nexus.youversion.com/api/cron/select-and-send \\`);
  console.log(`     -H "Authorization: Bearer $CRON_SECRET"`);
  console.log("═══════════════════════════════════════════════════════════════");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
