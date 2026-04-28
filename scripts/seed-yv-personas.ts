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
    name: "Anxious Abby",
    label: "Emotion-first",
    icon: "Heart",
    color: "purple",
    description: "28, marketing manager. Opens the app in moments of anxiety, grief, or overwhelm. Needs to feel seen before she feels taught.",
    tags: ["emotion-first", "anxiety", "wellness"],
  },
  {
    name: "Studious Sam",
    label: "Devotion-first",
    icon: "BookOpen",
    color: "blue",
    description: "42, high school teacher. Already has a 6am quiet-time habit. Wants depth, not encouragement. Easily condescended to.",
    tags: ["devotion-first", "study", "depth"],
  },
  {
    name: "Connected Callie",
    label: "Social-first",
    icon: "Share2",
    color: "green",
    description: "24, recent college grad. Faith lives in community. Downloaded because a friend sent a verse. Will leave if it feels solo.",
    tags: ["social-first", "community", "sharing"],
  },
  {
    name: "Word-driven William",
    label: "Bible-first",
    icon: "Quote",
    color: "amber",
    description: "55, retired pastor, seminary-trained. Skeptical of \"app-ified\" faith. Zero patience for friction. Wants the text, fast.",
    tags: ["bible-first", "scripture", "study"],
  },
  {
    name: "Plugged-in Priya",
    label: "Church-first",
    icon: "Landmark",
    color: "red",
    description: "35, young mom. Downloaded because her pastor said so during a sermon series. Stays only if her church is front-and-center.",
    tags: ["church-first", "pastor", "community"],
  },
  {
    name: "Searching Sebastian",
    label: "Seeker",
    icon: "Compass",
    color: "teal",
    description: "31, software engineer. Curious, not religious. Easily spooked by insider language. Wants a welcome mat, not a seminary.",
    tags: ["seeker", "new-user", "curious"],
  },
  {
    name: "Family-first Fiona",
    label: "Parent",
    icon: "CalendarDays",
    color: "orange",
    description: "38, stay-at-home mom of three. Time-poor, wants to lead her family in faith. Not here for a solo reading plan.",
    tags: ["parent", "family", "kids"],
  },
  {
    name: "Returning Ryan",
    label: "Re-engager",
    icon: "Sprout",
    color: "slate",
    description: "44, lapsed user. Was active two years ago, life got in the way. Back now — and shame will send him packing.",
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

  const userUpdateResult = await prisma.user.updateMany({
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
        description: p.description,
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
