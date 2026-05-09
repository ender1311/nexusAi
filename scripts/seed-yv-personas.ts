/**
 * Seed script: 8 YouVersion User Personas
 *
 * Replaces existing personas with the 8 behavioral archetypes:
 * 1. Anxious Abby — Emotion-first
 * 2. Studious Sam — Devotion-first
 * 3. Connected Callie — Social-first
 * 4. Word-driven William — Bible-first
 * 5. Plugged-in Priya — Church-first
 * 6. Searching Sebastian — Seeker
 * 7. Family-first Fiona — Parent
 * 8. Returning Ryan — Re-engager
 *
 * ⚠️  Destructive: clears all existing personas, persona arm stats,
 *     LinUCB arms, agent-persona targets, and user persona assignments.
 *
 * Usage: bun run scripts/seed-yv-personas.ts
 */

import { prisma } from "../src/lib/db";

const PERSONAS = [
  {
    name: "Anxious",
    label: "Emotion-first",
    icon: "Heart",
    color: "purple",
    tags: ["emotion-first", "anxiety", "wellness"],
  },
  {
    name: "Studious",
    label: "Devotion-first",
    icon: "BookOpen",
    color: "blue",
    tags: ["devotion-first", "study", "depth"],
  },
  {
    name: "Connected",
    label: "Social-first",
    icon: "Share2",
    color: "green",
    tags: ["social-first", "community", "sharing"],
  },
  {
    name: "Word-driven",
    label: "Bible-first",
    icon: "Quote",
    color: "amber",
    tags: ["bible-first", "scripture", "study"],
  },
  {
    name: "Plugged-in",
    label: "Church-first",
    icon: "Landmark",
    color: "red",
    tags: ["church-first", "pastor", "community"],
  },
  {
    name: "Searching",
    label: "Seeker",
    icon: "Compass",
    color: "teal",
    tags: ["seeker", "new-user", "curious"],
  },
  {
    name: "Family-first",
    label: "Parent",
    icon: "CalendarDays",
    color: "orange",
    tags: ["parent", "family", "kids"],
  },
  {
    name: "Returning",
    label: "Re-engager",
    icon: "Sprout",
    color: "slate",
    tags: ["re-engagement", "lapsed", "returning"],
  },
] as const;

async function main() {
  console.log("🌱 Seeding YouVersion personas...\n");

  // ── 1. Clear dependent data ──────────────────────────────────────────────
  console.log("Clearing dependent data...");

  const armStatsCount = await prisma.personaArmStats.deleteMany({});
  console.log(`  ✓ Deleted ${armStatsCount.count} PersonaArmStats`);

  const linUcbCount = await prisma.linUCBArm.deleteMany({});
  console.log(`  ✓ Deleted ${linUcbCount.count} LinUCBArm records`);

  const targetCount = await prisma.agentPersonaTarget.deleteMany({});
  console.log(`  ✓ Deleted ${targetCount.count} AgentPersonaTarget entries`);

  const userUpdateResult = await prisma.trackedUser.updateMany({
    data: { personaId: null, personaConfidence: null, personaAssignedAt: null },
  });
  console.log(`  ✓ Cleared persona assignment for ${userUpdateResult.count} users`);

  // ── 2. Delete existing personas ──────────────────────────────────────────
  const deletedPersonas = await prisma.persona.deleteMany({});
  console.log(`  ✓ Deleted ${deletedPersonas.count} existing personas\n`);

  // ── 3. Create the 8 new personas ─────────────────────────────────────────
  console.log("Creating 8 YouVersion personas...");

  const created: string[] = [];
  for (const p of PERSONAS) {
    const persona = await prisma.persona.create({
      data: {
        name: p.name,
        label: p.label,
        icon: p.icon,
        color: p.color,
        tags: p.tags,
        source: "manual",
        isActive: true,
      },
    });
    created.push(persona.id);
    console.log(`  + ${p.name} (${persona.id})`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n✅ Done! Created ${created.length} personas.`);
  console.log("\nNext steps:");
  console.log("  1. Wire personas to agents via the Settings UI or AgentPersonaTarget entries");
  console.log("  2. Re-run bun run scripts/seed-reengagement-agent.ts if you want arm stats");
  console.log("  3. Set up Hightouch to sync user behavioral attributes for persona assignment");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
