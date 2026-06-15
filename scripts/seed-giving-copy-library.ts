// Seeds evergreen giving push-copy variation into the library, mined from the
// Communications/Campaigns archive (giving / Sowers / partner / lapsed-giver
// campaigns). Time-bound copy (Giving Tuesday, EOY dates, specific match
// amounts, anniversaries) was intentionally excluded — these are always-on arms.
//
// All are library templates (agentId=null), category=giving, subcategory=
// dynamic-handle, strategy=blend/monthly: they route to the personalized give
// deeplink, never-givers fall to the $25 default, past-givers blend their
// history. Tokenized bodies use {{ask}} / {{bibles}}.
//
// Dry-run by default; --commit to write. Idempotent by name. prisma → .env.local (prod).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const COMMIT = process.argv.includes("--commit");

type Entry = { name: string; title: string; body: string; fit: "never" | "past" | "both"; tone: string; deeplink?: string };

// "Find out more" / learn-about-Sowers copy points at the Sowers info page instead
// of the personalized give URL (an explicit deeplink wins for dynamic-handle).
const SOWERS_URL = "https://youversion.com/sowers";

const ENTRIES: Entry[] = [
  // ── never-givers / both ───────────────────────────────────────────────────
  { name: "Giving Copy — Reach the world", title: "Let's reach the world!", body: "Give a monthly gift of {{ask}} to put the free Bible App in {{bibles}} more hands and help millions engage with God's Word.", fit: "never", tone: "urgency" },
  { name: "Giving Copy — What happens when I give", title: "What happens when I give?", body: "A monthly gift of {{ask}} puts the free Bible App in {{bibles}} more hands. Tap to find out more.", fit: "never", tone: "question", deeplink: SOWERS_URL },
  { name: "Giving Copy — Love in action", title: "Your love in action", body: "Discover how {{ask}} a month can put the Bible App in {{bibles}} more hands and share God's Word with others.", fit: "both", tone: "empathy" },
  { name: "Giving Copy — 195 countries", title: "Reach all 195 countries", body: "Help take the Bible to all 195 countries. A monthly gift of {{ask}} puts the Bible App in {{bibles}} more hands.", fit: "never", tone: "urgency" },
  { name: "Giving Copy — Won't stop", title: "We won't stop until this happens", body: "Together we can get God's Word to the world. Set up a recurring gift to reach even more people.", fit: "never", tone: "urgency" },
  { name: "Giving Copy — You're invited (Sowers)", title: "You're invited!", body: "Discover what it means to be a Sower of God's Word, and how you can join the Sowers Community.", fit: "never", tone: "question" },
  { name: "Giving Copy — People need God's Word", title: "People need God's Word...", body: "And your generosity will give them access. Here's what it means to be a Sower of God's Word.", fit: "never", tone: "empathy" },
  { name: "Giving Copy — Almost a billion", title: "Almost a billion people...", body: "...have never experienced God's Word in their heart language. Together, we can change that.", fit: "never", tone: "urgency" },
  { name: "Giving Copy — Share the power", title: "How has this changed your life?", body: "Discover how you can share the transformational power of God's Word with billions around the world.", fit: "both", tone: "question" },
  { name: "Giving Copy — Impact update", title: "Global impact update", body: "Here's how God is using our Community's generosity to change millions more lives this year.", fit: "both", tone: "milestone" },
  { name: "Giving Copy — Changed you", title: "How has God's Word changed you?", body: "God is using His Word to impact millions of lives around the world. You can be part of it.", fit: "both", tone: "question" },
  // ── past-givers ────────────────────────────────────────────────────────────
  { name: "Giving Copy — Not done yet", title: "We're not done yet", body: "More people still need to experience God's Word. Join us by setting up a recurring gift today.", fit: "past", tone: "urgency" },
  { name: "Giving Copy — Increase your impact", title: "Increase your impact", body: "When you set up a recurring gift, you help us get the Bible App to even more people.", fit: "past", tone: "question" },
  { name: "Giving Copy — Generosity made this happen", title: "Your generosity made this happen", body: "Your giving is changing lives. See the impact, and keep it going with a monthly gift.", fit: "past", tone: "milestone" },
  { name: "Giving Copy — Mission needs you", title: "This mission needs you", body: "Millions have met God through His Word because of you. Rejoin the movement with a monthly gift.", fit: "past", tone: "empathy" },
  { name: "Giving Copy — Next step", title: "Ready to take your next step?", body: "Set up a monthly gift to help take God's Word to the world.", fit: "past", tone: "question" },
  { name: "Giving Copy — Essential part", title: "You're an essential part of this", body: "Continue making an eternal impact by setting up a monthly gift.", fit: "past", tone: "empathy" },
  { name: "Giving Copy — Impact you've made", title: "See the impact you've made", body: "Your generosity has helped change lives around the world. Keep it going with a monthly gift.", fit: "past", tone: "milestone" },
];

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} — ${ENTRIES.length} giving copy variants\n`);
  let message = await prisma.message.findFirst({ where: { agentId: null, channel: "push", variants: { some: { category: "giving" } } } });
  if (!message && COMMIT) message = await prisma.message.create({ data: { agentId: null, name: "giving Templates", channel: "push" } });

  const existing = message ? await prisma.messageVariant.findMany({ where: { message: { agentId: null, channel: "push" } }, select: { name: true } }) : [];
  const existingNames = new Set(existing.map((v) => v.name));

  let created = 0, skipped = 0;
  for (const e of ENTRIES) {
    if (existingNames.has(e.name)) { skipped++; console.log(`  skip (exists): ${e.name}`); continue; }
    if (!COMMIT) { console.log(`  [dry-run] ${e.name}  [${e.fit}]\n      ${e.title} — ${e.body}`); created++; continue; }
    await prisma.messageVariant.create({
      data: {
        messageId: message!.id, name: e.name, title: e.title, body: e.body, deeplink: e.deeplink ?? null,
        category: "giving", subcategory: "dynamic-handle", status: "active",
        actionFeatures: {
          tone: e.tone, hasPersonalization: e.body.includes("{{"), ctaType: "deeplink", messageLengthBucket: "short",
          givingHandleStrategy: "blend", givingFrequency: "monthly",
        } as Prisma.InputJsonValue,
      },
    });
    created++;
  }
  console.log(`\n${COMMIT ? "Inserted" : "[dry-run] would insert"} ${created}, skipped ${skipped}.`);
  if (!COMMIT) console.log("Re-run with --commit to write.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
