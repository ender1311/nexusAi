/**
 * Backfill persona assignment for lapsed users.
 *
 * Users ingested before the lapsed → Re-engager override was deployed may have
 * been assigned the wrong persona (or none at all). This script finds all
 * TrackedUsers with funnelStage "lapsed" or "lapsed_mau" and sets their
 * personaId to the "Re-engager" persona.
 *
 * Run against production:
 *   DATABASE_URL="<unpooled-url>" npx tsx prisma/backfill-lapsed-persona.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const reengager = await prisma.persona.findFirst({
    where: { label: "Re-engager" },
    select: { id: true, name: true },
  });

  if (!reengager) {
    console.error("Re-engager persona not found — run fix-persona-labels.ts first.");
    process.exit(1);
  }

  console.log(`Re-engager persona: ${reengager.name} (${reengager.id})`);

  // Count before
  const lapsedUsers = await prisma.trackedUser.findMany({
    where: { funnelStage: { in: ["lapsed", "lapsed_mau"] } },
    select: { id: true, externalId: true, funnelStage: true, personaId: true },
  });

  console.log(`\nFound ${lapsedUsers.length} lapsed/lapsed_mau users`);

  const alreadyCorrect = lapsedUsers.filter((u) => u.personaId === reengager.id);
  const needsUpdate = lapsedUsers.filter((u) => u.personaId !== reengager.id);

  console.log(`  Already Re-engager: ${alreadyCorrect.length}`);
  console.log(`  Needs update:       ${needsUpdate.length}`);

  if (needsUpdate.length === 0) {
    console.log("\nAll lapsed users already have the correct persona. Nothing to do.");
    return;
  }

  const result = await prisma.trackedUser.updateMany({
    where: {
      funnelStage: { in: ["lapsed", "lapsed_mau"] },
      NOT: { personaId: reengager.id },
    },
    data: {
      personaId: reengager.id,
      personaConfidence: 0.8,
      personaAssignedAt: new Date(),
    },
  });

  console.log(`\nUpdated ${result.count} users → Re-engager persona.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
