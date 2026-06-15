// Seeds push variants adapted from the approved "DAU4 → BAS (Become A Sower)"
// campaign doc (June 2026, copywriter Kali) — pushes + modal + content cards +
// email headlines, all reframed for push. Targets the same dau4 audience as the
// Lydia/Solomon giving agents.
//
// Routing mirrors the doc:
//   - "BAS Webflow Landing Page" copy (informational: find out / what it means) →
//     explicit Sowers deeplink (https://youversion.com/sowers).
//   - "In-App Give Form" copy (direct ask) → no explicit deeplink → the engine
//     builds the personalized give URL.
// Copy citing "$25 / 600 Bible apps" is tokenized with {{ask}}/{{bibles}} so the
// amount/impact personalize per user.
//
// All are library templates (agentId=null), category=giving, subcategory=
// dynamic-handle, blend/monthly. Dry-run by default; --commit to write.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const COMMIT = process.argv.includes("--commit");
const SOWERS_URL = "https://youversion.com/sowers";

type Entry = { name: string; title: string; body: string; route: "sowers" | "give"; tone: string };

const ENTRIES: Entry[] = [
  // ── Push #1 series (awareness → BAS landing / Sowers info) ──────────────────
  { name: "BAS Push — Consistently in the Word", title: "You're consistently in God's Word!", body: "That faithfulness is what our Sowers Community is all about. Find out what a Sower is.", route: "sowers", tone: "milestone" },
  { name: "BAS Push — Every time you open", title: "Every time you open God's Word…", body: "Your relationship with God grows deeper. Share that gift with others — become a Sower.", route: "sowers", tone: "empathy" },
  { name: "BAS Push — Join the Sowers Community", title: "Join the Sowers Community!", body: "The Bible App is free because of the generosity of our Sowers Community. Become a Sower today.", route: "sowers", tone: "urgency" },
  // ── Push #2 series (conversion mechanics → In-App Give Form) ────────────────
  { name: "BAS Push — Takes 60 seconds", title: "This takes 60 seconds…", body: "It's easy to become a Sower. Set up a monthly gift of any amount and watch what God does.", route: "give", tone: "question" },
  { name: "BAS Push — Powerful way to make an impact", title: "A powerful way to make an impact…", body: "Become a Sower — a gift of {{ask}} a month distributes over {{bibles}} Bible apps this year.", route: "give", tone: "milestone" },
  { name: "BAS Push — By this time next year", title: "By this time next year…", body: "Your generosity will have planted God's Word in every corner of the world. Become a Sower.", route: "give", tone: "milestone" },
  // ── Push #3 series (urgency / global need → BAS landing) ────────────────────
  { name: "BAS Push — Share hope today", title: "You can share hope today!", body: "Your generosity can help others experience the Good News of Jesus. Here's how.", route: "sowers", tone: "empathy" },
  { name: "BAS Push — People need God's Word", title: "People need God's Word…", body: "And your generosity will give them access. Here's what it means to be a Sower.", route: "sowers", tone: "urgency" },
  { name: "BAS Push — World searching for answers", title: "The world is searching for answers…", body: "Some may never find the truth. Become a Sower and take God's Word to them.", route: "sowers", tone: "urgency" },
  // ── In-App modal → push (direct give, tokenized) ────────────────────────────
  { name: "BAS Modal — You're invited", title: "You're invited to join the Sowers Community!", body: "A gift of {{ask}} a month will distribute over {{bibles}} Bible apps this year.", route: "give", tone: "question" },
  // ── Content cards → push ─────────────────────────────────────────────────────
  { name: "BAS Card — Take God's Word to the world", title: "Take God's Word to the world", body: "Join the Sowers Community! Here's what it means to be a Sower of God's Word.", route: "sowers", tone: "urgency" },
  { name: "BAS Card — Starving for truth", title: "The world is starving for truth", body: "Some may never find it. Take the truth of God's Word to them by becoming a Sower.", route: "sowers", tone: "urgency" },
  // ── Email headlines → push ───────────────────────────────────────────────────
  { name: "BAS Email — Eternal impact", title: "You can make an eternal impact", body: "One of the most powerful ways to change lives — become a Sower.", route: "give", tone: "milestone" },
  { name: "BAS Email — More to your habit", title: "More to your Bible habit than you know…", body: "Someone gave so you can experience God's Word. Discover the Sowers Community.", route: "sowers", tone: "question" },
];

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} — ${ENTRIES.length} BAS campaign push variants\n`);
  let message = await prisma.message.findFirst({ where: { agentId: null, channel: "push", variants: { some: { category: "giving" } } } });
  if (!message && COMMIT) message = await prisma.message.create({ data: { agentId: null, name: "giving Templates", channel: "push" } });
  const existing = message ? await prisma.messageVariant.findMany({ where: { message: { agentId: null, channel: "push" } }, select: { name: true } }) : [];
  const existingNames = new Set(existing.map((v) => v.name));

  let created = 0, skipped = 0;
  for (const e of ENTRIES) {
    if (existingNames.has(e.name)) { skipped++; console.log(`  skip (exists): ${e.name}`); continue; }
    const deeplink = e.route === "sowers" ? SOWERS_URL : null;
    if (!COMMIT) { console.log(`  [dry-run] ${e.name}  [${e.route}]\n      ${e.title} — ${e.body}`); created++; continue; }
    await prisma.messageVariant.create({
      data: {
        messageId: message!.id, name: e.name, title: e.title, body: e.body, deeplink,
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
