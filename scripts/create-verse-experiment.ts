// scripts/create-verse-experiment.ts
// Create the "Resurrection Verse Push" experiment: one push Message with four
// title-strategy arms (reference / headline-a / headline-b / inverted). Each arm
// is a MessageVariant whose body is VERSE_PUSH_SENTINEL; the cron resolves a
// rotated, localized verse at send time. Dry-run by default; pass --commit.
//
// prisma here targets .env.local (production) per CLAUDE.md — review the dry run.
import { prisma } from "@/lib/db";
import { VERSE_PUSH_SENTINEL, VERSE_STRATEGY, type VerseStrategy } from "@/lib/verse-content";

const ARMS: Array<{ strategy: VerseStrategy; name: string; title: string }> = [
  { strategy: "reference",  name: "Reference title",      title: "[verse:reference]" },
  { strategy: "headline-a", name: "Headline A (clickbait)", title: "[verse:a-title]" },
  { strategy: "headline-b", name: "Headline B (ref sentence)", title: "[verse:b-title]" },
  { strategy: "inverted",   name: "Inverted (text in title)", title: "[verse:inverted]" },
];

async function main() {
  const doCommit = process.argv.includes("--commit");
  console.log(`Verse-push experiment — ${doCommit ? "COMMIT" : "DRY RUN"}`);
  for (const a of ARMS) {
    console.log(`  arm ${a.strategy.padEnd(11)} title="${a.title}" body=${VERSE_PUSH_SENTINEL} ` +
      `(title<-${VERSE_STRATEGY[a.strategy].title}, body<-${VERSE_STRATEGY[a.strategy].body})`);
  }
  if (!doCommit) { console.log("\nDRY RUN — nothing written. Re-run with --commit."); return; }

  const agent = await prisma.agent.create({
    data: { name: "Resurrection Verse Push", description: "Title-strategy experiment over localized scripture verses.",
      status: "draft", algorithm: "thompson", localizePush: true },
  });
  const message = await prisma.message.create({
    data: { agentId: agent.id, name: "Resurrection Verse", channel: "push" },
  });
  for (const a of ARMS) {
    await prisma.messageVariant.create({
      data: { messageId: message.id, name: a.name, body: VERSE_PUSH_SENTINEL, title: a.title,
        status: "active", category: "verse-experiment", subcategory: a.strategy },
    });
  }
  console.log(`\nCreated agent ${agent.id} (draft), message ${message.id}, ${ARMS.length} arms.`);
  console.log("Activate + set targeting in the UI before launching.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
