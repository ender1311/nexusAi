/**
 * Seed script: Push Copy Template Library
 *
 * Deletes all existing variants under __push-copy-library__ and re-seeds
 * with 5 new categories (reader, plans, votd, guided-scripture, guided-prayer)
 * and subcategories. One Message row per category; ~35 variants total.
 *
 * Usage: bun run scripts/seed-push-copy-templates.ts
 * Idempotent: deletes + recreates on every run.
 */

import { prisma } from "../src/lib/db";

const LIBRARY_AGENT_NAME = "__push-copy-library__";

type VariantDef = {
  subcategory: string;
  name: string;
  title: string;
  body: string;
  deeplink: string;
  cta: string;
  actionFeatures: {
    tone: "empathy" | "urgency" | "question" | "milestone";
    hasPersonalization: boolean;
    ctaType: "deeplink";
    messageLengthBucket: "short" | "medium" | "long";
  };
};

type CategoryDef = {
  category: string;
  messageName: string;
  variants: VariantDef[];
};

const CATEGORIES: CategoryDef[] = [
  // ── Reader ─────────────────────────────────────────────────────────────────
  {
    category: "reader",
    messageName: "Reader Templates",
    variants: [
      // open-bible subcategory
      {
        subcategory: "open-bible",
        name: "Consistency",
        title: "Growth is not about perfection…",
        body: "It's about consistency ➡️",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "open-bible",
        name: "Who Do You Want to Be",
        title: "Who do you want to be?",
        body: "Here's what happens when you spend time with God ➡️",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "open-bible",
        name: "Next Step (Personalized)",
        title: '{{${first_name} | default: "friend"}}, what\'s your next step?',
        body: "Open your Bible App today!",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "open-bible",
        name: "Daily Word Waiting",
        title: "Your daily word is waiting",
        body: "Open the Bible App to read today.",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "open-bible",
        name: "Still Thinking About You",
        title: "Still thinking about you",
        body: "Come back and spend some time in the Word.",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "open-bible",
        name: "One Verse",
        title: "One verse can change your day",
        body: "Start with just one.",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "open-bible",
        name: "He's Waiting",
        title: "He's waiting to speak to you",
        body: "Open your Bible App and listen.",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      // specific-verse subcategory
      {
        subcategory: "specific-verse",
        name: "Listen to God (John 3:16)",
        title: "👂 Listen to God today",
        body: "Reflect on the Verse of the Day ➡️",
        deeplink: "youversion://bible?reference=JHN.3.16",
        cta: "Read John 3:16",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "specific-verse",
        name: "Next Step (Psalm 23)",
        title: '{{${first_name} | default: "friend"}}, what\'s your next step?',
        body: "Spend time with Him in the Bible App today.",
        deeplink: "youversion://bible?reference=PSA.23.1",
        cta: "Read Psalm 23",
        actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "specific-verse",
        name: "Peace is Possible (Phil 4)",
        title: "Peace is possible",
        body: "Read Philippians 4:6–7 today.",
        deeplink: "youversion://bible?reference=PHP.4.6",
        cta: "Read Philippians 4",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "specific-verse",
        name: "He Calls You by Name (Isa 43)",
        title: "He calls you by name",
        body: "Open Isaiah 43:1 and be reminded.",
        deeplink: "youversion://bible?reference=ISA.43.1",
        cta: "Read Isaiah 43",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      // audio-bible subcategory
      {
        subcategory: "audio-bible",
        name: "Hear His Word (John 1)",
        title: "Hear His Word today",
        body: "Listen to the Bible in your Bible App.",
        deeplink: "https://www.bible.com/bible/1/JHN.1?audio=true",
        cta: "Listen Now",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "audio-bible",
        name: "Let the Word Speak (Psalm 23)",
        title: "Let the Word speak to you",
        body: "Listen to the Bible App today.",
        deeplink: "https://www.bible.com/bible/1/PSA.23?audio=true",
        cta: "Listen Now",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
    ],
  },

  // ── Plans ──────────────────────────────────────────────────────────────────
  {
    category: "plans",
    messageName: "Plans Templates",
    variants: [
      // find-plans subcategory
      {
        subcategory: "find-plans",
        name: "Congrats — Completed Plan",
        title: "Congrats! You completed a Plan!",
        body: "Choose another Plan and keep your momentum going.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium" },
      },
      {
        subcategory: "find-plans",
        name: "Looking for Next Step",
        title: "Looking for your next step?",
        body: "Explore Bible reading plans for every season.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "find-plans",
        name: "Start Something New",
        title: "Start something new today",
        body: "Discover a reading plan that fits your life.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "find-plans",
        name: "30 Days Life Changing",
        title: "30 days. Life-changing.",
        body: "Find a plan and start growing.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "find-plans",
        name: "There's a Plan for That",
        title: "There's a plan for that",
        body: "Find a Bible reading plan for exactly where you are.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "find-plans",
        name: "New Year New Plan",
        title: "New year, new plan?",
        body: "Start a reading plan today.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      // my-plans subcategory
      {
        subcategory: "my-plans",
        name: "Who Do You Want to Be (My Plans)",
        title: "Who do you want to be?",
        body: "Here's what happens when you spend time with God ➡️",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "my-plans",
        name: "Day N Is Waiting",
        title: 'Day {{${next_plan_day} | default: "1"}} is waiting',
        body: "Continue your plan and keep the streak going.",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "my-plans",
        name: "Don't Lose Your Streak",
        title: "Don't lose your streak",
        body: "Open your plan before midnight.",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "my-plans",
        name: "You've Come This Far",
        title: "You've come this far",
        body: "Keep going — your plan is waiting.",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      // saved-plans subcategory
      {
        subcategory: "saved-plans",
        name: "Saved Plan — Ready to Start",
        title: "You saved a plan — ready to start?",
        body: "Pick it up and begin today.",
        deeplink: "https://www.bible.com/saved_plans",
        cta: "View Saved Plans",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "saved-plans",
        name: "Saved Plans Still There",
        title: "Your saved plans are still there",
        body: "Ready when you are.",
        deeplink: "https://www.bible.com/saved_plans",
        cta: "View Saved Plans",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
    ],
  },

  // ── VOTD ───────────────────────────────────────────────────────────────────
  {
    category: "votd",
    messageName: "Verse of the Day Templates",
    variants: [
      {
        subcategory: "votd-page",
        name: "What Will God Say",
        title: "What will God say to you today?",
        body: "Check out the Verse of the Day ➡️",
        deeplink: "https://www.bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "votd-page",
        name: "Today's Verse Is for You",
        title: "Today's verse is for you",
        body: "See the Verse of the Day.",
        deeplink: "https://www.bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "votd-page",
        name: "A Word for Today",
        title: "A word for today",
        body: "Reflect on the Verse of the Day.",
        deeplink: "https://www.bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "votd-page",
        name: "His Word Is a Lamp",
        title: "His Word is a lamp",
        body: "Read today's verse now.",
        deeplink: "https://www.bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "votd-page",
        name: "It's Ready for You",
        title: "It's ready for you",
        body: "The Verse of the Day is waiting.",
        deeplink: "https://www.bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "votd-page",
        name: "Verse of the Day Is Live",
        title: "The Verse of the Day is live",
        body: "Open the Bible App to read it.",
        deeplink: "https://www.bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
    ],
  },

  // ── Guided Scripture ───────────────────────────────────────────────────────
  {
    category: "guided-scripture",
    messageName: "Guided Scripture Templates",
    variants: [
      {
        subcategory: "todays-story",
        name: "Pause with God",
        title: "⏸️ Pause with God",
        body: "Take a moment with Him today…",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "todays-story",
        name: "Today's Story Is Waiting",
        title: "Today's story is waiting",
        body: "Open Guided Scripture in the Bible App.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "todays-story",
        name: "Few Minutes With God",
        title: "A few minutes with God changes everything",
        body: "Read today's Guided Scripture.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "todays-story",
        name: "He Speaks Through His Word",
        title: "He speaks through His Word",
        body: "Read today's Guided Scripture story.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "todays-story",
        name: "Something to Think About",
        title: "Something to think about today",
        body: "Open Guided Scripture and reflect.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "todays-story",
        name: "Moment of Peace",
        title: "A moment of peace is one tap away",
        body: "Open today's story in the Bible App.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
    ],
  },

  // ── Guided Prayer ──────────────────────────────────────────────────────────
  {
    category: "guided-prayer",
    messageName: "Guided Prayer Templates",
    variants: [
      // prayer-list subcategory
      {
        subcategory: "prayer-list",
        name: "Have a Minute (Prayer List)",
        title: "Have a minute?",
        body: "Spend time with God in Guided Prayer.",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "prayer-list",
        name: "He Hears You",
        title: "He hears you",
        body: "Open your Prayer list in the Bible App.",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "prayer-list",
        name: "Prayer Changes Things",
        title: "Prayer changes things",
        body: "Spend a moment with God.",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "prayer-list",
        name: "Your Prayers Are Stored Here",
        title: "Your prayers are stored here",
        body: "Review and add to your prayer list.",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      // guided-prayer subcategory
      {
        subcategory: "guided-prayer",
        name: "Have a Minute (Guided Prayer)",
        title: "Have a minute?",
        body: "Spend time with God in Guided Prayer.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "guided-prayer",
        name: "Walk with God Today",
        title: "Walk with God today",
        body: "Try Guided Prayer in the Bible App.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
      {
        subcategory: "guided-prayer",
        name: "You Don't Have to Figure It Out Alone",
        title: "You don't have to figure it out alone",
        body: "Let Guided Prayer lead the way.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
      },
    ],
  },
];

async function main() {
  console.log("🌱 Seeding push copy template library...\n");

  // Find or create the library agent
  let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
  if (agent) {
    console.log(`  ✓ Library agent found (${agent.id})`);
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

  // Delete all existing messages (cascades to variants via DB onDelete: Cascade)
  const deleted = await prisma.message.deleteMany({ where: { agentId: agent.id } });
  if (deleted.count > 0) {
    console.log(`  ✗ Deleted ${deleted.count} existing message(s) (old categories cleared)\n`);
  }

  // Re-seed all categories
  let totalVariants = 0;
  for (const cat of CATEGORIES) {
    const message = await prisma.message.create({
      data: { agentId: agent.id, name: cat.messageName, channel: "push" },
    });
    console.log(`  + Created message "${cat.messageName}" (${message.id})`);

    for (const v of cat.variants) {
      await prisma.messageVariant.create({
        data: {
          messageId: message.id,
          name: v.name,
          title: v.title,
          body: v.body,
          deeplink: v.deeplink,
          cta: v.cta,
          category: cat.category,
          subcategory: v.subcategory,
          status: "active",
          actionFeatures: v.actionFeatures,
        },
      });
      console.log(`    + ${v.name} [${v.subcategory}]`);
      totalVariants++;
    }
  }

  console.log(`\n✅ Done — ${totalVariants} variants seeded across ${CATEGORIES.length} categories.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
