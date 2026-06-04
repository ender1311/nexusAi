// scripts/create-verse-experiment.ts
// Create the "Resurrection Verse Push" experiment: one push Message with four
// title-strategy arms (reference / headline-a / headline-b / inverted). Each arm
// is a MessageVariant whose body is VERSE_PUSH_SENTINEL; the cron resolves a
// rotated, localized verse at send time. Dry-run by default; pass --commit.
//
// prisma here targets .env.local (production) per CLAUDE.md — review the dry run.
import { prisma } from "@/lib/db";
import { VERSE_PUSH_SENTINEL, VERSE_STRATEGY, type VerseStrategy } from "@/lib/verse-content";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";

const ARMS: Array<{ strategy: VerseStrategy; name: string; title: string }> = [
  { strategy: "reference",  name: "Reference title",      title: "[verse:reference]" },
  { strategy: "headline-a", name: "Headline A (clickbait)", title: "[verse:a-title]" },
  { strategy: "headline-b", name: "Headline B (ref sentence)", title: "[verse:b-title]" },
  { strategy: "inverted",   name: "Inverted (text in title)", title: "[verse:inverted]" },
];

async function main() {
  const doCommit = process.argv.includes("--commit");
  console.log(`Verse-push experiment — ${doCommit ? "COMMIT" : "DRY RUN"}`);
  const withImageDry = process.argv.includes("--with-image");
  for (const a of ARMS) {
    console.log(`  arm ${a.strategy.padEnd(11)} title="${a.title}" body=${VERSE_PUSH_SENTINEL} ` +
      `(title<-${VERSE_STRATEGY[a.strategy].title}, body<-${VERSE_STRATEGY[a.strategy].body})` +
      (withImageDry ? "  [+ paired image arm]" : ""));
  }
  if (!doCommit) { console.log("\nDRY RUN — nothing written. Re-run with --commit."); return; }

  const agent = await prisma.agent.create({
    data: { name: "Resurrection Verse Push", description: "Title-strategy experiment over localized scripture verses.",
      status: "draft", algorithm: "thompson", localizePush: true },
  });
  const message = await prisma.message.create({
    data: { agentId: agent.id, name: "Resurrection Verse", channel: "push" },
  });
  const withImage = process.argv.includes("--with-image");
  for (const a of ARMS) {
    const variants = withImage
      ? [
          { name: a.name, iconImageUrl: null as string | null },
          { name: `${a.name} + image`, iconImageUrl: VERSE_IMAGE_SENTINEL as string | null },
        ]
      : [{ name: a.name, iconImageUrl: null as string | null }];
    for (const v of variants) {
      await prisma.messageVariant.create({
        data: { messageId: message.id, name: v.name, body: VERSE_PUSH_SENTINEL, title: a.title,
          status: "active", category: "verse-experiment", subcategory: a.strategy,
          ...(v.iconImageUrl && { iconImageUrl: v.iconImageUrl }) },
      });
    }
  }
  const armCount = withImage ? ARMS.length * 2 : ARMS.length;
  console.log(`\nCreated agent ${agent.id} (draft), message ${message.id}, ${armCount} arms.`);
  console.log("Activate + set targeting in the UI before launching.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
