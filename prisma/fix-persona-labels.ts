/**
 * Fix persona labels so classifyPersona() can assign users to the correct persona.
 *
 * The ingest endpoint looks up personas by label:
 *   personaByLabel.get("Seeker") → personaId
 *
 * The classifier returns semantic labels; the DB currently has first-name labels
 * (Sarah, Marcus, …) from the original seed. This script patches the label field
 * on each manual persona to match the classifier's vocabulary.
 *
 * Run against production:
 *   DATABASE_URL="<unpooled-url>" npx tsx prisma/fix-persona-labels.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

// Maps persona name (stable, used as the key) → classifier label the ingest
// endpoint should resolve for assigned users.
// Personas with no classifier match get null — they stay in the DB for the UI
// but won't receive auto-assigned users from the ingest pipeline.
const LABEL_FIXES: Record<string, string | null> = {
  "Lapsed Believer": "Re-engager",    // lifetimeFinishes>=2, yearCount=0
  "New Believer":    "Seeker",         // lifetimeFinishes=0, yearCount<5
  "Teen Explorer":   "Seeker",         // same bucket — young, very low engagement
  "Deep Diver":      "Bible-first",    // long plans, low prayer
  "Pastor":          "Bible-first",    // long plans, professional use
  "Prayer Warrior":  "Emotion-first",  // high guided-prayer count
  "Morning Devotee": "Devotion-first", // high yearCount, plan-focused
  "Social Sharer":   "Social-first",   // badge_current_year_count / sharing
  "Video Watcher":   "Social-first",   // visual-first, young — closest match
  "Weekend Warrior": "Church-first",   // church-goer identity
  "Audio Commuter":  null,             // no classifier rule covers audio-only users
  "VOTD Only":       null,             // light-touch reader, no classifier rule
};

async function main() {
  console.log("Fixing persona labels…\n");

  const personas = await prisma.persona.findMany({
    where: { source: "manual" },
    select: { id: true, name: true, label: true },
  });

  if (personas.length === 0) {
    console.log("No manual personas found — nothing to fix.");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const persona of personas) {
    if (!(persona.name in LABEL_FIXES)) {
      console.log(`  SKIP  ${persona.name} — not in fix map`);
      skipped++;
      continue;
    }

    const newLabel = LABEL_FIXES[persona.name];
    if (persona.label === newLabel) {
      console.log(`  OK    ${persona.name} — label already "${newLabel ?? "null"}"`);
      skipped++;
      continue;
    }

    await prisma.persona.update({
      where: { id: persona.id },
      data: { label: newLabel },
    });

    console.log(`  FIXED ${persona.name}: "${persona.label}" → "${newLabel ?? "null"}"`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);

  // Verify — show the final state
  console.log("\nFinal label map:");
  const final = await prisma.persona.findMany({
    where: { source: "manual" },
    select: { name: true, label: true },
    orderBy: { name: "asc" },
  });
  for (const p of final) {
    const marker = p.label ? "✓" : "–";
    console.log(`  ${marker}  ${p.name.padEnd(20)} → ${p.label ?? "(no classifier match)"}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
