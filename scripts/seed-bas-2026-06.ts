/**
 * Seed the June 2026 "Become a Sower" (BAS / DAU4→BAS) giving assets into the
 * content libraries, copying the existing giving-template structure.
 *
 * Source: "DAU4 to BAS Workflow (06_2026)" campaign doc. Push + email giving
 * copy already lives in the libraries (BAS pushes + dynamic-handle Sower asks);
 * the gaps are the modal-IAM invite and the two pinned content cards. Each new
 * variant is created under the channel's existing "giving … Templates" library
 * message (agentId = null) with category "giving". Idempotent: re-runs skip
 * variants whose name already exists.
 *
 * Usage: bun scripts/seed-bas-2026-06.ts
 */
import { prisma } from "@/lib/db";

type Seed = {
  channel: string;
  messageName: string; // the library "… Templates" message to attach under
  name: string;
  title: string;
  body: string;
  cta: string | null;
  subcategory: string;
};

const SEEDS: Seed[] = [
  {
    channel: "modal-iam",
    messageName: "giving Modal IAM Templates",
    name: "2026-06 BAS — Sowers Invite",
    title: "You’re invited to join the Sowers Community!",
    body: "A gift of $25 a month will distribute over 600 Bible apps this year.",
    cta: "Give a Monthly Gift",
    subcategory: "sowers",
  },
  {
    channel: "content-card",
    messageName: "giving Content Card Templates",
    name: "2026-06 BAS — Take God’s Word to the World",
    title: "Take God’s Word to the world.",
    body: "Join the Sowers Community! Here’s what it means to be a Sower of God’s Word.",
    cta: "Tell Me More",
    subcategory: "appeal",
  },
  {
    channel: "content-card",
    messageName: "giving Content Card Templates",
    name: "2026-06 BAS — World Starving for Truth",
    title: "The world is starving for truth.",
    body: "And some people may never find it. You can take the truth of God’s Word to them by becoming a Sower.",
    cta: "Tell Me More",
    subcategory: "appeal",
  },
];

async function findOrCreateLibraryMessage(channel: string, name: string): Promise<string> {
  const existing = await prisma.message.findFirst({ where: { agentId: null, channel, name } });
  if (existing) return existing.id;
  const created = await prisma.message.create({ data: { agentId: null, channel, name } });
  return created.id;
}

async function main() {
  let created = 0;
  let skipped = 0;
  for (const s of SEEDS) {
    const messageId = await findOrCreateLibraryMessage(s.channel, s.messageName);
    const dupe = await prisma.messageVariant.findFirst({
      where: { messageId, name: s.name },
      select: { id: true },
    });
    if (dupe) {
      console.log(`SKIP (exists): [${s.channel}] ${s.name}`);
      skipped++;
      continue;
    }
    await prisma.messageVariant.create({
      data: {
        messageId,
        name: s.name,
        title: s.title,
        body: s.body, // body is non-nullable; mirror title intent for non-push channels
        cta: s.cta,
        category: "giving",
        subcategory: s.subcategory,
        status: "active",
      },
    });
    console.log(`CREATED: [${s.channel}] ${s.name}`);
    created++;
  }
  console.log(`\nDone. created=${created} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
