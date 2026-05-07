/**
 * One-time fix: remove English "friend" fallback from Liquid first_name defaults.
 * Replaces `| default: "friend"` and `| default: "Friend"` with `| default: ""`
 * so non-English users don't receive the hardcoded English word.
 *
 * Run: bun prisma/fix-friend-capitalization.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const variants = await prisma.messageVariant.findMany({
    where: {
      OR: [
        { title: { contains: '| default: "friend"' } },
        { title: { contains: "| default: 'friend'" } },
        { title: { contains: "| default: 'Friend'" } },
        { title: { contains: '| default: "Friend"' } },
      ],
    },
    select: { id: true, title: true },
  });

  console.log(`Found ${variants.length} variant(s) to fix.`);

  let updated = 0;
  for (const v of variants) {
    if (!v.title) continue;
    const fixed = v.title
      .replaceAll('| default: "Friend"', '| default: ""')
      .replaceAll('| default: "friend"', '| default: ""')
      .replaceAll("| default: 'Friend'", '| default: ""')
      .replaceAll("| default: 'friend'", '| default: ""');
    if (fixed !== v.title) {
      await prisma.messageVariant.update({ where: { id: v.id }, data: { title: fixed } });
      console.log(`  Fixed: ${v.id}`);
      updated++;
    }
  }

  console.log(`Done. Updated ${updated} record(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
