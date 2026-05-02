/**
 * Seed script: Push Copy Template Library
 *
 * Creates a __push-copy-library__ agent with 9 approved MessageVariant rows
 * across 4 destination categories. These are the canonical templates operators
 * select when creating agents in the wizard. They are cloned (not referenced)
 * into each agent's own variants via sourceTemplateId.
 *
 * Copy sourced from: docs/push-copy-inventory.md
 * Deep-links sourced from: docs/deeplinks.md
 *
 * Usage: bun run scripts/seed-push-copy-templates.ts
 * Idempotent: safe to run multiple times.
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { prisma } from "../src/lib/db";

const LIBRARY_AGENT_NAME = "__push-copy-library__";

const TEMPLATES: Array<{
  category: string;
  messageName: string;
  name: string;
  title: string;
  body: string;
  deeplink: string;
  cta: string;
  actionFeatures: object;
}> = [
  // ── Bible Verse ────────────────────────────────────────────────────────
  {
    category: "bible-verse",
    messageName: "Bible Verse Templates",
    name: "A — Consistency",
    title: "Growth is not about perfection…",
    body: "It's about consistency ➡️",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "bible-verse",
    messageName: "Bible Verse Templates",
    name: "B — VOTD",
    title: "👂 Listen to God today",
    body: "Reflect on the Verse of the Day ➡️",
    deeplink: "youversion://bible?reference=JHN.3.16",
    cta: "Read John 3:16",
    actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "bible-verse",
    messageName: "Bible Verse Templates",
    name: "D — Personalized",
    title: '{{${first_name} | default: "friend"}}, what\'s your next step?',
    body: "Spend time with Him in the Bible App today.",
    deeplink: "youversion://bible?reference=PSA.23.1",
    cta: "Read Psalm 23",
    actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  // ── Guided Scripture ──────────────────────────────────────────────────
  {
    category: "guided-scripture",
    messageName: "Guided Scripture Templates",
    name: "C — Pause",
    title: "⏸️ Pause with God",
    body: "Take a moment with Him today…",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "guided-scripture",
    messageName: "Guided Scripture Templates",
    name: "C — Prayer",
    title: "Have a minute?",
    body: "Spend time with God in Guided Prayer.",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  // ── Plans ─────────────────────────────────────────────────────────────
  {
    category: "plans",
    messageName: "Plans Templates",
    name: "Lapsing Plans",
    title: "Congrats! You completed a Plan!",
    body: "Choose another Plan and keep your momentum going.",
    deeplink: "https://www.bible.com/reading-plans",
    cta: "Find a Plan",
    actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium" },
  },
  {
    category: "plans",
    messageName: "Plans Templates",
    name: "Resume",
    title: "Who do you want to be?",
    body: "Here's what happens when you spend time with God ➡️",
    deeplink: "https://www.bible.com/my-plans",
    cta: "Continue My Plans",
    actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  // ── General ───────────────────────────────────────────────────────────
  {
    category: "general",
    messageName: "General Re-engagement Templates",
    name: "A2 — Habit",
    title: "Growth is not about perfection…",
    body: "It's about consistency ➡️",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "general",
    messageName: "General Re-engagement Templates",
    name: "D2 — Next Step",
    title: '{{${first_name} | default: "friend"}}, what\'s your next step?',
    body: "Open your Bible App today!",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
  },
];

async function main() {
  console.log("🌱 Seeding push copy template library...\n");

  // Find or create the library agent
  let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
  if (agent) {
    console.log(`  ✓ Library agent already exists (${agent.id})`);
  } else {
    agent = await prisma.agent.create({
      data: {
        name: LIBRARY_AGENT_NAME,
        description: "Canonical push copy templates. Never used for decisions — status stays draft.",
        algorithm: "thompson",
        epsilon: 0.1,
        status: "draft",
        funnelStage: "connected",
      },
    });
    console.log(`  + Created library agent (${agent.id})`);
  }

  // Group templates by messageName and upsert
  const byMessage = new Map<string, typeof TEMPLATES>();
  for (const t of TEMPLATES) {
    const list = byMessage.get(t.messageName) ?? [];
    list.push(t);
    byMessage.set(t.messageName, list);
  }

  let totalVariants = 0;
  for (const [msgName, variants] of byMessage) {
    let message = await prisma.message.findFirst({
      where: { agentId: agent.id, name: msgName },
    });
    if (!message) {
      message = await prisma.message.create({
        data: { agentId: agent.id, name: msgName, channel: "push" },
      });
      console.log(`  + Created message "${msgName}" (${message.id})`);
    } else {
      console.log(`  ✓ Message "${msgName}" already exists (${message.id})`);
    }

    for (const t of variants) {
      const existing = await prisma.messageVariant.findFirst({
        where: { messageId: message.id, name: t.name },
      });
      if (existing) {
        console.log(`    ✓ Variant "${t.name}" already exists`);
      } else {
        await prisma.messageVariant.create({
          data: {
            messageId: message.id,
            name: t.name,
            title: t.title,
            body: t.body,
            deeplink: t.deeplink,
            cta: t.cta,
            category: t.category,
            status: "active",
            actionFeatures: t.actionFeatures,
          },
        });
        console.log(`    + Created variant "${t.name}" (${t.category})`);
        totalVariants++;
      }
    }
  }

  console.log(`\n✅ Done — ${totalVariants} new variants seeded.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
