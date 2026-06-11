/**
 * Seed script: Push Copy Template Library
 *
 * Rebuilt from real Dropbox campaign data (2023–2026).
 * English copy only — Braze handles localization at send time.
 *
 * Source campaign mapping:
 *   reader/open-bible       2026-01 Daily reward-remind (reward + remind), 2025-01 Reward-Remind Push,
 *                           2025-01 It Starts with the Bible, 2023-05 TA May
 *   reader/specific-verse   2025-01 Reward-Remind Push, 2023-04 TA April,
 *                           2025-10 Search Workflow
 *   reader/audio-bible      No dedicated audio campaign found — evergreen adaptations
 *   plans/find-plans        2025-12 Bible in One Year Plans, 2025-02 Lapsing Plans Workflow,
 *                           2023-01 Featured Plans, 2025-01 New Testament Plans,
 *                           2025-10-06 Featured Plans
 *   plans/my-plans          2026-02 BiOY Workflow (remind + reward), 2026-01 Plans Nurture Workflow
 *   plans/saved-plans       No dedicated saved-plans campaign — evergreen adaptations
 *   votd/votd-page          2026 Resurrection Push, 2026-01 Daily reward-remind (remind),
 *                           2023-04 TA April, 2023-05 TA May, 2023-06 TA June (verse)
 *   votd/todays-story       2023-06 TA June (story), 2025-02 Guided Scripture - Peace,
 *                           2023-04 Holy Spirit Plans
 *   guided-scripture        2024-08 Guided Scripture (Doubt/Suffering),
 *                           2025-01 Guided Scripture (Transformation),
 *                           2024-10 Guided Scripture (Fruit of Spirit),
 *                           2024-11 Guided Scripture (Honoring God),
 *                           2025-06 Guided Scripture (Beatitudes)
 *   guided-prayer/guided-prayer  2025-09 Prayer Nurture Workflow,
 *                                2024-06 Rest Focus Guided Prayer
 *   guided-prayer/prayer-list    2025-09 Prayer Nurture Workflow
 *
 * Usage: bun run scripts/seed-push-copy-templates.ts
 * Idempotent: deletes all existing variants under __push-copy-library__ and re-seeds.
 */

import { prisma } from "../src/lib/db";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";

const LIBRARY_AGENT_NAME = "Push Copy Library";

type VariantDef = {
  subcategory: string | null;
  name: string;
  title: string;
  body: string;
  deeplink: string;
  cta: string;
  iconImageUrl?: string;
  actionFeatures: {
    tone: "empathy" | "urgency" | "question" | "milestone";
    hasPersonalization: boolean;
    ctaType: "deeplink";
    messageLengthBucket: "short" | "medium" | "long";
    sourceFile: string;
  };
};

// Reward variants are triggered after a user reads (celebrate the action).
// They are paused until the reward send pipeline is configured.
// "daily-reward-PUSH-N" = post-read reward; "daily-reward-remind-REMIND-N" = re-engagement remind (not a reward).
function isRewardVariant(v: VariantDef): boolean {
  const src = v.actionFeatures.sourceFile;
  // Open-bible reward variants: sourceFile contains "daily-reward-PUSH-" (not "daily-reward-remind")
  if (/daily-reward-PUSH-\d+/.test(src)) return true;
  // BiOY reward variants use PUSH-2 through PUSH-20; remind variants use PUSH-22+
  const bioyMatch = src.match(/bioy-workflow-PUSH-(\d+)/);
  if (bioyMatch) return parseInt(bioyMatch[1]) <= 20;
  return false;
}

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
        name: "Build Your Bible Habit",
        title: "...seek me with all your heart",
        body: "Build your Bible habit today.",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-remind-REMIND-1-en.json" },
      },
      {
        subcategory: "open-bible",
        name: "Pause with God",
        title: "⏸️ Pause with God today.",
        body: "Open your Bible App to spend time in His Word!",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-01-reward-remind-PUSH3-en.json" },
      },
      {
        subcategory: "open-bible",
        name: "Pick Up Where You Left Off",
        title: "What was the last verse you read?",
        body: "Pick up where you left off in God's Word.",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-01-reward-remind-PUSH4-en.json" },
      },
      {
        subcategory: "open-bible",
        name: "What Will God Tell You",
        title: "What will God tell you today?",
        body: "See what God's Word will say to you today ➡️",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-remind-REMIND-7-en.json" },
      },
      {
        subcategory: "open-bible",
        name: "What Could Your Life Look Like",
        title: "What could your life look like?",
        body: "Spending time with God will transform you into who you want to become. Try this ➡️",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-01-it-starts-with-the-bible-PUSH-en.json" },
      },
      {
        subcategory: "open-bible",
        name: "You Can Do This (Personalized)",
        title: '{{${first_name} | default: "Friend"}}, you can do this!',
        body: "See what God's Word will say to you today ➡️",
        deeplink: "youversion://bible",
        cta: "Open Bible App",
        actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-remind-REMIND-3-en.json" },
      },
      {
        subcategory: "open-bible",
        name: "Nothing Can Change His Love",
        title: "God loves you…",
        body: "And nothing can change that. Remind yourself of His love with this verse.",
        deeplink: "youversion://bible?reference=ROM.8.38-39",
        cta: "Open Bible App",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-04-ta-may1-PUSH-en.json" },
      },
      // open-bible — 2026-01 Daily Reward pushes (celebration message sent after reading)
      { subcategory: "open-bible", name: "What Did God Teach You (Reward)", title: "What did God teach you?", body: "Let's read the Bible today.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-1-en.json" } },
      { subcategory: "open-bible", name: "Another Step Forward (Reward)", title: "🙌 Another Step Forward", body: "You spent time in God's Word today. Keep going strong!", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-2-en.json" } },
      { subcategory: "open-bible", name: "Gold Star for You (Reward)", title: "🌟 Gold star for you!", body: "You made space for spending time with God today—keep it up.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-3-en.json" } },
      { subcategory: "open-bible", name: "What Did God Show You (Reward)", title: "What did God show you?", body: "Let's read the Bible today.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-4-en.json" } },
      { subcategory: "open-bible", name: "Cheering You On (Reward)", title: "We're cheering you on!", body: "Spending time in God's Word? That's a win worth celebrating.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-5-en.json" } },
      { subcategory: "open-bible", name: "Cheering You On (Personalized Reward)", title: '{{${first_name} | default: "Friend"}}, we\'re cheering you on!', body: "Spending time in God's Word? That's a win worth celebrating.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-5-en.json" } },
      { subcategory: "open-bible", name: "High Five (Reward)", title: "Give yourself a high five! 🙏", body: "You spent another day in God's Word.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-6-en.json" } },
      { subcategory: "open-bible", name: "You Did It (Reward)", title: "🎉 You did it! 🎉", body: "Great job building your Bible habit.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-7-en.json" } },
      { subcategory: "open-bible", name: "You're Doing It (Reward)", title: "You're doing it! 🥳", body: "You're actively engaging in God's Word. Keep it up!", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-8-en.json" } },
      { subcategory: "open-bible", name: "Keep It Up (Reward)", title: "Keep it up!", body: "You're building your Bible habit this month. 🥳", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-9-en.json" } },
      { subcategory: "open-bible", name: "Keep It Up (Personalized Reward)", title: '{{${first_name} | default: "Friend"}}, keep it up!', body: "You're building your Bible habit this month. 🥳", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-9-en.json" } },
      { subcategory: "open-bible", name: "Let's Reflect (Personalized Reward)", title: '{{${first_name} | default: "Friend"}}, let\'s reflect!', body: "What is God's Word teaching you?", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-10-en.json" } },
      { subcategory: "open-bible", name: "Your Consistency Is Inspiring (Reward)", title: "Your consistency is inspiring!", body: "What have you learned from God's Word today?", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-11-en.json" } },
      { subcategory: "open-bible", name: "How Has Your Faith Grown (Personalized Reward)", title: '{{${first_name} | default: "Friend"}}, how has your faith grown?', body: "Reflect on what you're discovering this month.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-12-en.json" } },
      { subcategory: "open-bible", name: "Building Your Bible Habit (Reward)", title: "🔨 You're building your Bible habit!", body: "Keep going ➡️", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-13-en.json" } },
      { subcategory: "open-bible", name: "Reflect on What You've Learned (Personalized Reward)", title: '{{${first_name} | default: "Friend"}}, reflect on what you\'ve learned!', body: "What has God been teaching you this month?", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-14-en.json" } },
      { subcategory: "open-bible", name: "What Verse Stood Out (Personalized Reward)", title: '{{${first_name} | default: "Friend"}}, what verse stood out today?', body: "Keep going deeper in God's Word ➡️", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-reward-PUSH-15-en.json" } },
      // open-bible — 2026-01 Daily Remind pushes (linking to bible.com/today content)
      { subcategory: "open-bible", name: "What Will You Learn (Remind)", title: "What will you learn?", body: "What will God teach you through His Word?", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-2-en.json" } },
      { subcategory: "open-bible", name: "What Will You Learn (Personalized Remind)", title: '{{${first_name} | default: "Friend"}}, what will you learn?', body: "What will God teach you through His Word?", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-2-en.json" } },
      { subcategory: "open-bible", name: "One Day at a Time (Personalized Remind)", title: 'One day at a time, {{${first_name} | default: "friend"}}…', body: "…You can build your Bible habit! Reflect on God's Word ➡️", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-daily-remind-PUSH-4-en.json" } },
      { subcategory: "open-bible", name: "Keep Going (Personalized Remind)", title: '{{${first_name} | default: "Friend"}}, keep going!', body: "Build your Bible habit today.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-5-en.json" } },
      { subcategory: "open-bible", name: "How Will God's Word Shape You (Remind)", title: "How will God's Word shape you?", body: "Explore God's Word ➡️", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-6-en.json" } },
      { subcategory: "open-bible", name: "Reflect on God's Word (Remind)", title: "Reflect on God's Word 🙏", body: "What will you learn today?", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-8-en.json" } },
      { subcategory: "open-bible", name: "Prayer Can Change Lives (Remind)", title: "🙏 Prayer can change lives.", body: "Experience nighttime prayer before you end your day.", deeplink: "https://www.bible.com/guides/1", cta: "Open Bible", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-12-en.json" } },
      { subcategory: "open-bible", name: "Looking for Something New (Remind)", title: "Looking for something new?", body: "Tap to find content made for you.", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-14-en.json" } },
      { subcategory: "open-bible", name: "Keep Going This Month (Personalized Remind)", title: 'Keep going, {{${first_name} | default: "friend"}}!', body: "Imagine what you'll learn during this month ➡️", deeplink: "https://www.bible.com/today", cta: "Open Bible", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-16-en.json" } },
      // specific-verse subcategory
      {
        subcategory: "specific-verse",
        name: "Do Not Fear (Isaiah 41:10)",
        title: '"Do not fear, for I am with you…"',
        body: "God is your strength and help! Spend some time with Him reflecting on Isaiah 41:10 today.",
        deeplink: "youversion://bible?reference=ISA.41.10",
        cta: "Read Isaiah 41:10",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-01-reward-remind-PUSH1-en.json" },
      },
      {
        subcategory: "specific-verse",
        name: "The Lord Is My Shepherd (Psalm 23)",
        title: '"The Lord is my shepherd…"',
        body: "Sit in God's presence and reflect on Psalm 23.",
        deeplink: "youversion://bible?reference=PSA.23.1",
        cta: "Read Psalm 23",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-01-reward-remind-PUSH5-en.json" },
      },
      {
        subcategory: "specific-verse",
        name: "Your Sins Are Forgiven (Luke 7)",
        title: '"Your sins are forgiven."',
        body: "Get to know God through His Word today! Open Luke 7 for the full story.",
        deeplink: "youversion://bible?reference=LUK.7.48",
        cta: "Read Luke 7",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-01-reward-remind-PUSH2-en.json" },
      },
      {
        subcategory: "specific-verse",
        name: "Peace I Leave with You (John 14:27)",
        title: '"Peace I leave with you."',
        body: "Jesus promises peace that is greater than your circumstances. Draw near to Him with this verse.",
        deeplink: "youversion://bible?reference=JHN.14.27",
        cta: "Read John 14:27",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2023-04-ta-april4-PUSH-en.json" },
      },
      {
        subcategory: "specific-verse",
        name: "You Are Loved (John 3:16)",
        title: "You are loved 💗",
        body: "Discover the depth of God's love for you with this verse…",
        deeplink: "youversion://bible?reference=JHN.3.16",
        cta: "Read John 3:16",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-04-ta-april1-PUSH-en.json" },
      },
      {
        subcategory: "specific-verse",
        name: "Need Strength (Isaiah 40:31)",
        title: "Need strength? 💪",
        body: "Learn to put your hope in God with Isaiah 40:31.",
        deeplink: "youversion://bible?reference=ISA.40.31",
        cta: "Read Isaiah 40:31",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-10-search-workflow-PUSH-4-en.json" },
      },
      // audio-bible subcategory
      {
        subcategory: "audio-bible",
        name: "Hear His Word (John 1)",
        title: "Hear His Word today",
        body: "Listen to the Bible in your Bible App.",
        deeplink: "https://www.bible.com/bible/1/JHN.1?audio=true",
        cta: "Listen Now",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "evergreen-audio-bible" },
      },
      {
        subcategory: "audio-bible",
        name: "Let the Word Speak (Psalm 23)",
        title: "Let the Word speak to you",
        body: "Listen to the Bible today.",
        deeplink: "https://www.bible.com/bible/1/PSA.23?audio=true",
        cta: "Listen Now",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "evergreen-audio-bible" },
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
        name: "You Can Do This — Bible in a Year",
        title: "You can do this. (Yes, you!)",
        body: "In just 15 minutes a day, you can read through the entire Bible in one year! Start one of these Plans 👉",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "long", sourceFile: "2025-12-bible-in-one-year-plans-PUSH-1-en.json" },
      },
      {
        subcategory: "find-plans",
        name: "Let's Read the Entire Bible",
        title: "Let's read the entire Bible!",
        body: "Experience the big picture of God's love. Start one of these Plans and invite friends to join you.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-12-bible-in-one-year-plans-PUSH-2-en.json" },
      },
      {
        subcategory: "find-plans",
        name: "It Doesn't Stop Here",
        title: "It doesn't stop here…",
        body: "We're so happy you finished a Plan. Choose another one today to spend more time with God.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-02-lapsing-plans-user-workflow-PUSH-en.json" },
      },
      {
        subcategory: "find-plans",
        name: "Need a Fresh Start",
        title: "Need a fresh start?",
        body: "God is making all things new. Continue to draw near to Him with these Plans.",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-01-featured-plans-PUSH-en.json" },
      },
      {
        subcategory: "find-plans",
        name: "Challenge Yourself",
        title: "Challenge yourself this year…",
        body: "Choose a Plan to read through the entire New Testament. We know you can do it! 💪",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-01-new-testament-plans-PUSH-en.json" },
      },
      {
        subcategory: "find-plans",
        name: "When Fear Overwhelms",
        title: "When fear overwhelms you…",
        body: "Turn to God—He wants to help. Explore what the Bible says with one of these Plans ➡️",
        deeplink: "https://www.bible.com/reading-plans",
        cta: "Find a Plan",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-10-06-featured-plans-PUSH-en.json" },
      },
      // find-plans — 2026-01 Daily Remind push-9
      { subcategory: "find-plans", name: "How Are You Today (Remind)", title: "How are you today?", body: "There's a Plan for whatever you're feeling. Find one today!", deeplink: "https://www.bible.com/reading-plans", cta: "Find a Plan", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-9-en.json" } },
      { subcategory: "find-plans", name: "How Are You Today (Personalized Remind)", title: '{{${first_name} | default: "Friend"}}, how are you today?', body: "There's a Plan for whatever you're feeling. Find one today!", deeplink: "https://www.bible.com/reading-plans", cta: "Find a Plan", actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-9-en.json" } },
      // my-plans subcategory
      {
        subcategory: "my-plans",
        name: "Your Plan Awaits",
        title: "Your Plan awaits…",
        body: "Complete another Plan day today!",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-plans-nurture-workflow-PUSH-21-en.json" },
      },
      {
        subcategory: "my-plans",
        name: "Pick Up Where You Left Off (My Plans)",
        title: "Pick up where you left off!",
        body: "Continue your Plan and spend time in God's Word today ➡️",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-02-bioy-workflow-PUSH-22-en.json" },
      },
      {
        subcategory: "my-plans",
        name: "God's Word Awaits",
        title: "God's Word awaits…",
        body: "Continue your Plan today!",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-02-bioy-workflow-PUSH-29-en.json" },
      },
      {
        subcategory: "my-plans",
        name: "Keep Going (Personalized)",
        title: '{{${first_name} | default: "Friend"}}, keep going!',
        body: "Complete another day of your Plan.",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-02-bioy-workflow-PUSH-34-en.json" },
      },
      {
        subcategory: "my-plans",
        name: "Missing Something",
        title: "Missing something?",
        body: "Return to your Plan to reconnect with God's Word!",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-02-bioy-workflow-PUSH-26-en.json" },
      },
      {
        subcategory: "my-plans",
        name: "Great Job",
        title: "Great job! 👏",
        body: "You're doing amazing! Continue your Plan ➡️",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-02-bioy-workflow-PUSH-1-en.json" },
      },
      {
        subcategory: "my-plans",
        name: "What Did You Learn Today (Personalized)",
        title: '{{${first_name} | default: "Friend"}}, what did you learn today?',
        body: "You spent time in your Plan! Take some time to reflect on what God is saying to you.",
        deeplink: "https://www.bible.com/my-plans",
        cta: "Continue My Plans",
        actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-02-bioy-workflow-PUSH-3-en.json" },
      },
      // ── BiOY 2026-01 reward (celebrating completion) ──────────────────────
      { subcategory: "my-plans", name: "👏👏👏 (BiOY)", title: "👏👏👏", body: "You took another step toward reading the entire Bible today! Keep it up ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-2.json" } },
      { subcategory: "my-plans", name: "Take a Moment (BiOY)", title: "Take a moment…", body: "And congratulate yourself for completing another day of your year-long Bible Plan! 🎉", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-4.json" } },
      { subcategory: "my-plans", name: "Another Day Closer (BiOY)", title: "✅ Another day closer…", body: "…to reading the Bible this year! Continue your Plan ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-5.json" } },
      { subcategory: "my-plans", name: "That's How It's Done (BiOY)", title: "🔥 That's how it's done!", body: "Another day down in your whole Bible Plan. 👏", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-6.json" } },
      { subcategory: "my-plans", name: "Stay Focused (BiOY)", title: "🙏 Stay focused!", body: "You're another day closer to reading the entire Bible in a year.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-7.json" } },
      { subcategory: "my-plans", name: "Not Just Checking a Box (BiOY)", title: "You're not just checking a box…", body: "You spent time in God's presence today! Great job doing your whole Bible Plan.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-8.json" } },
      { subcategory: "my-plans", name: "Consistency Is Key (BiOY)", title: "Consistency is 🗝️", body: "You're doing great! Keep up with your Plan as you read the entire Bible this year.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-9.json" } },
      { subcategory: "my-plans", name: "You're Doing It (BiOY)", title: "You're doing it!", body: "With your Plan, you'll read the entire Bible this year. Keep it up! 👏", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-10.json" } },
      { subcategory: "my-plans", name: "High Five (Personalized)", title: '{{${first_name} | default: "Friend"}}, high five! 🫸🫷', body: "Way to go completing another day of your whole Bible Plan.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-11.json" } },
      { subcategory: "my-plans", name: "You're Amazing (Personalized)", title: '{{${first_name} | default: "Friend"}}, you\'re amazing!', body: "You completed another day of your whole Bible Plan.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-12.json" } },
      { subcategory: "my-plans", name: "🎉 Celebrations (Personalized)", title: '{{${first_name} | default: "Friend"}}, 🎉🎉🎉', body: "Way to go completing another day of your whole Bible Plan!", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-13.json" } },
      { subcategory: "my-plans", name: "Star for You (Personalized)", title: '{{${first_name} | default: "Friend"}}, ⭐ for you', body: "You spent time in God's Word today!", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-14.json" } },
      { subcategory: "my-plans", name: "Take Time to Reflect (Personalized)", title: '{{${first_name} | default: "Friend"}}, take time to reflect!', body: "What did God teach you in your whole Bible Plan today?", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-15.json" } },
      { subcategory: "my-plans", name: "Another Step (Personalized)", title: '{{${first_name} | default: "Friend"}}, you took another step!', body: "You're another day closer to reading the entire Bible.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-16.json" } },
      { subcategory: "my-plans", name: "Spent Time with God (Personalized)", title: '{{${first_name} | default: "Friend"}}, you spent time with God!', body: "Great work being with God today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-17.json" } },
      { subcategory: "my-plans", name: "Small Steps Matter (Personalized)", title: '{{${first_name} | default: "Friend"}}, small steps matter.', body: "You're one step closer to reading the entire Bible!", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-18.json" } },
      { subcategory: "my-plans", name: "Pause and Celebrate (Personalized)", title: '{{${first_name} | default: "Friend"}}, pause and celebrate!', body: "You took another step toward reading the whole Bible today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "milestone", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-19.json" } },
      { subcategory: "my-plans", name: "God Is Guiding You (Personalized)", title: '{{${first_name} | default: "Friend"}}, God is guiding you!', body: "You spent time with God and took another step toward reading the whole Bible.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-20.json" } },
      // ── BiOY 2026-01 remind (re-engagement nudges) ────────────────────────
      { subcategory: "my-plans", name: "What If… (BiOY)", title: "What if…", body: "You spent a few minutes in God's Word today? Continue your whole Bible Plan and rest with Him 🙏", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-22.json" } },
      { subcategory: "my-plans", name: "Imagine… (BiOY)", title: "Imagine… 🤔", body: "What could God say to you today? Complete another day of your year-long Plan ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-23.json" } },
      { subcategory: "my-plans", name: "In Less Than 15 Minutes (BiOY)", title: "In less than 15 minutes a day…", body: "You could read the entire Bible in a year! Take another step in your Plan ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-01-bioy-workflow-PUSH-24.json" } },
      { subcategory: "my-plans", name: "Uncover Something New (BiOY)", title: "Uncover something new… 🧐", body: "See what God has for you today by continuing your whole Bible Plan ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-26.json" } },
      { subcategory: "my-plans", name: "Taking a Break (BiOY)", title: "Taking a break?", body: "Spend it with God! Open your whole Bible Plan and rest with Him.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-27.json" } },
      { subcategory: "my-plans", name: "Your Journey Continues (BiOY)", title: "Your journey continues here.", body: "Take another step in reading the entire Bible ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-29.json" } },
      { subcategory: "my-plans", name: "Yes, You Can (BiOY)", title: "Yes, you can.", body: "This year, you can read the entire Bible! Continue your Plan today ➡️", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-30.json" } },
      { subcategory: "my-plans", name: "Don't Forget (Personalized)", title: '{{${first_name} | default: "Friend"}}, don\'t forget…', body: "Continue reading your whole Bible Plan today!", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-31.json" } },
      { subcategory: "my-plans", name: "You Can Do It (Personalized)", title: '{{${first_name} | default: "Friend"}}, you can do it!', body: "Continue reading your whole Bible Plan today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-32.json" } },
      { subcategory: "my-plans", name: "Keep Going (BiOY Personalized)", title: '{{${first_name} | default: "Friend"}}, keep going!', body: "Complete another day of your whole Bible Plan.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-33.json" } },
      { subcategory: "my-plans", name: "You've Got This (Personalized)", title: '{{${first_name} | default: "Friend"}}, you\'ve got this!', body: "Keep going in your whole Bible Plan today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-34.json" } },
      { subcategory: "my-plans", name: "Got a Moment (Personalized)", title: '{{${first_name} | default: "Friend"}}, got a moment?', body: "Continue your whole Bible Plan today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-35.json" } },
      { subcategory: "my-plans", name: "Ready to Continue (Personalized)", title: '{{${first_name} | default: "Friend"}}, ready to continue?', body: "Return to your whole Bible Plan today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-36.json" } },
      { subcategory: "my-plans", name: "Did You Know (Personalized)", title: '{{${first_name} | default: "Friend"}}, did you know…', body: "You can read the entire Bible! Return to your whole Bible Plan today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-37.json" } },
      { subcategory: "my-plans", name: "Spend Time with God (Personalized)", title: '{{${first_name} | default: "Friend"}}, spend time with God!', body: "Pick up where you left off on your whole Bible Plan today.", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-38.json" } },
      { subcategory: "my-plans", name: "Open Your Bible (Personalized)", title: '{{${first_name} | default: "Friend"}}, open your Bible.', body: "Continue reading your whole Bible Plan today!", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-39.json" } },
      { subcategory: "my-plans", name: "Need Encouragement (Personalized)", title: '{{${first_name} | default: "Friend"}}, need encouragement?', body: "Continue reading your whole Bible Plan today!", deeplink: "https://www.bible.com/my-plans", cta: "Continue My Plans", actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-bioy-workflow-PUSH-40.json" } },
      // saved-plans subcategory
      {
        subcategory: "saved-plans",
        name: "Saved Plan Ready to Start",
        title: "You saved a Plan — ready to start?",
        body: "Pick it up and begin today.",
        deeplink: "https://www.bible.com/saved_plans",
        cta: "View Saved Plans",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "evergreen-saved-plans" },
      },
      {
        subcategory: "saved-plans",
        name: "Saved Plans Still There",
        title: "Your saved Plans are still there",
        body: "Ready when you are.",
        deeplink: "https://www.bible.com/saved_plans",
        cta: "View Saved Plans",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "evergreen-saved-plans" },
      },
    ],
  },

  // ── VOTD ───────────────────────────────────────────────────────────────────
  {
    category: "votd",
    messageName: "Verse of the Day Templates",
    variants: [
      // votd-page subcategory
      {
        subcategory: "votd-page",
        name: "You Are Loved (VOTD)",
        title: "You are loved 💗",
        body: "Discover the depth of God's love for you with the Verse of the Day.",
        deeplink: "https://bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-04-ta-april1-PUSH-en.json" },
      },
      {
        subcategory: "votd-page",
        name: "Give Thanks in All Circumstances (VOTD)",
        title: '"Give thanks in all circumstances."',
        body: "Spend time with God and thank Him for what He's doing in your life with this verse.",
        deeplink: "https://bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2023-06-ta-reader-2-PUSH-en.json" },
      },
      {
        subcategory: "votd-page",
        name: "I Have Overcome the World (VOTD)",
        title: '"I have overcome the world."',
        body: "Jesus said we will face trials, but we can put our hope in Him. Remember that with today's verse.",
        deeplink: "https://bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2023-06-ta-reader-1-PUSH-en.json" },
      },
      {
        subcategory: "votd-page",
        name: "God Created You for a Purpose",
        title: "God created you for a purpose.",
        body: "Draw near to Him with today's verse ➡️",
        deeplink: "https://bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-04-ta-may3-PUSH-en.json" },
      },
      {
        subcategory: "votd-page",
        name: "Share Today's Verse",
        title: "Who could you share this with?",
        body: "Encourage them today by sharing the Verse of the Day.",
        deeplink: "https://bible.com/verse-of-the-day",
        cta: "See Verse of the Day",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-06-ta-verse-2-PUSH-en.json" },
      },
      // votd-page — 2026-01 Daily Remind pushes (verse-of-the-day deeplink)
      { subcategory: "votd-page", name: "God's Word Can Change a Life (Remind)", title: "God's Word can change a life.", body: "Read this verse and let God's Word transform you today.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-10-en.json" } },
      { subcategory: "votd-page", name: "Don't Miss This (Remind)", title: "Don't miss this!", body: "Spend time with God and read the Verse of the Day.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-11-en.json" } },
      { subcategory: "votd-page", name: "Don't Miss This (Personalized Remind)", title: '{{${first_name} | default: "Friend"}}, don\'t miss this!', body: "Spend time with God and read the Verse of the Day.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "urgency", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-11-en.json" } },
      { subcategory: "votd-page", name: "God Cares for You (Remind)", title: "God cares for you.", body: "Reflect on the Verse of the Day today.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-13-en.json" } },
      { subcategory: "votd-page", name: "God Cares for You (Personalized Remind)", title: '{{${first_name} | default: "Friend"}}, God cares for you.', body: "Reflect on the Verse of the Day today.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-01-daily-remind-PUSH-13-en.json" } },
      // votd-page — 2026 Resurrection Push (daily rotating verse teaser → VOTD page)
      { subcategory: "votd-page", name: "Never Give Up (Resurrection)", title: "✊ Never give up!", body: "Though outwardly we are wasting away, yet inwardly we are being renewed day by day.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "Be Strong and Courageous (Resurrection)", title: "💪 Be strong and courageous! 🛡 God is with you…", body: "Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "Delight in the Lord (Resurrection)", title: "🤗 Delight yourself in the Lord…", body: "Take delight in the Lord, and he will give you the desires of your heart.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "Don't Worry About Anything (Resurrection)", title: "🙏 \"Don't worry about anything; instead…\"", body: "Don't worry about anything; instead, pray about everything. Tell God what you need, and thank him for all he has done.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "long", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "I Can Do All Things (Resurrection)", title: "💪 We can do more because God gives us strength…", body: "I can do all this through him who gives me strength.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "I Am the Way (Resurrection)", title: "🛣 \"I am the way, …the truth, and the life…\"", body: "Jesus answered, I am the way and the truth and the life. No one comes to the Father except through me.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "Seek Me with All Your Heart (Resurrection)", title: "🔍 Seek me with all your heart…", body: "You will seek me and find me when you seek me with all your heart.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      { subcategory: "votd-page", name: "Darkest Valley (Resurrection)", title: "💪 Even in the darkest valley, I will not be afraid…", body: "Even though I walk through the darkest valley, I will fear no evil, for you are with me; your rod and your staff, they comfort me.", deeplink: "https://bible.com/verse-of-the-day", cta: "See Verse of the Day", actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "long", sourceFile: "2026-Q1-resurrection-Bmessage-en.yml" } },
      // todays-story subcategory
      {
        subcategory: "todays-story",
        name: "He Was Lost and Is Found",
        title: '"He was lost, and is found."',
        body: "Experience the redemption we have in Jesus with the story of the Prodigal Son.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Today's Story",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2023-06-ta-story-1-PUSH-int.json" },
      },
      {
        subcategory: "todays-story",
        name: "God Keeps His Promises",
        title: "God keeps His promises.",
        body: "God was with His people, and He is with you now. Experience the story of the Capture of Jericho.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Today's Story",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2023-06-ta-story-2-PUSH-int.json" },
      },
      {
        subcategory: "todays-story",
        name: "In the Middle of the Storm",
        title: "In the middle of the storm…",
        body: "Who do you look at? Learn to look at God and His peace in today's story.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Today's Story",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-02-guided-scripture-peace-PUSH-en.json" },
      },
      {
        subcategory: "todays-story",
        name: "Who Is the Holy Spirit",
        title: "Who is the Holy Spirit?",
        body: "Discover how God's Holy Spirit is at work in your life today.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Today's Story",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2023-04-holy-spirit-plans-PUSH-en.json" },
      },
    ],
  },

  // ── Guided Scripture ───────────────────────────────────────────────────────
  // No subcategory split — subcategory is null for all variants.
  {
    category: "guided-scripture",
    messageName: "Guided Scripture Templates",
    variants: [
      {
        subcategory: null,
        name: "Why Did This Happen — Doubt",
        title: '"Why did this happen?"',
        body: "Open Guided Scripture to learn how to wrestle with doubt.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2024-08-Guided-Scripture-Doubt-PUSH-1-en.json" },
      },
      {
        subcategory: null,
        name: "Find Hope in Suffering",
        title: "❤️ Find hope in suffering",
        body: "Open Guided Scripture to discover how God meets you in the hard seasons.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2024-08-guided-scripture-suffering-PUSH-3-en.json" },
      },
      {
        subcategory: null,
        name: "Can I Change — Transformation",
        title: '"Can I change?"',
        body: "God has the power to transform lives—including yours! Open Guided Scripture.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-01-guided-scripture-transformation-PUSH1-en.json" },
      },
      {
        subcategory: null,
        name: "Fruit of the Spirit",
        title: '🍊 "The fruit of the Spirit is…"',
        body: "Learn more about Galatians 5 in Guided Scripture.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2024-10-guided-scripture-fruit-of-the-spirit-PUSH-en.json" },
      },
      {
        subcategory: null,
        name: "When Life Is Tough — Honoring God",
        title: "When life is tough…",
        body: "How do you honor God? Open Guided Scripture for a three-day series on honoring God.",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2024-11-guided-scripture-honoring-god-PUSH-en.json" },
      },
      {
        subcategory: null,
        name: "Explore the Sermon on the Mount",
        title: "⛰️ Explore the Sermon on the Mount",
        body: "Visit Guided Scripture this week for special content!",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-06-guided-scripture-beatitudes-PUSH-en.json" },
      },
      // --- Dynamic VOTD variants (liquid tags resolved at send time) ---
      {
        subcategory: null,
        name: "VOTD: Label + Reference",
        title: "{{guided_scripture_label}}",
        body: "{{votd_reference}}",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: null,
        name: "VOTD: Label + Reference (Verse Image)",
        title: "{{guided_scripture_label}}",
        body: "{{votd_reference}}",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        iconImageUrl: VERSE_IMAGE_SENTINEL,
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: null,
        name: "VOTD: Label + Verse Text",
        title: "{{guided_scripture_label}}",
        body: "{{votd_text}}",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: null,
        name: "VOTD: Label + Verse Text (Verse Image)",
        title: "{{guided_scripture_label}}",
        body: "{{votd_text}}",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        iconImageUrl: VERSE_IMAGE_SENTINEL,
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: null,
        name: "VOTD: Reference + Label",
        title: "{{votd_reference}}",
        body: "{{guided_scripture_label}}",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: null,
        name: "VOTD: Reference + Label (Verse Image)",
        title: "{{votd_reference}}",
        body: "{{guided_scripture_label}}",
        deeplink: "https://www.bible.com/stories",
        cta: "Open Guided Scripture",
        iconImageUrl: VERSE_IMAGE_SENTINEL,
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
    ],
  },

  // ── Guided Prayer ──────────────────────────────────────────────────────────
  {
    category: "guided-prayer",
    messageName: "Guided Prayer Templates",
    variants: [
      // guided-prayer subcategory
      {
        subcategory: "guided-prayer",
        name: "Want Peace",
        title: "Want peace?",
        body: "Write a Prayer Card about the areas of life where you need peace today.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-1-en.json" },
      },
      {
        subcategory: "guided-prayer",
        name: "Ready to Spend Time in Prayer",
        title: "Ready to spend time in prayer?",
        body: "Create a Prayer Card and talk to God about what's on your mind today.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-2-en.json" },
      },
      {
        subcategory: "guided-prayer",
        name: "God Knows Your Heart",
        title: "God knows your ❤️",
        body: "Talk to Him about what's on your mind. Create a Prayer Card to spend time with Him today!",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-3-en.json" },
      },
      {
        subcategory: "guided-prayer",
        name: "Come to Me",
        title: '"Come to me…"',
        body: "Write a Prayer to give your burdens to God and find rest in Him today.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-4-en.json" },
      },
      {
        subcategory: "guided-prayer",
        name: "In Every Situation",
        title: "In every situation…",
        body: "Keep talking to God! He loves to hear from you.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-5-en.json" },
      },
      {
        subcategory: "guided-prayer",
        name: "Pray for Your Week Ahead",
        title: "Pray for your week ahead!",
        body: "God wants to hear about what's on your mind. Open Guided Prayer to get started.",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "urgency", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2024-06-rest-guided-prayer-PUSH-en.json" },
      },
      // prayer-list subcategory
      {
        subcategory: "prayer-list",
        name: "What Should I Pray About",
        title: '"What should I pray about?"',
        body: "Let Psalm 19:14 inspire your words. Create a Prayer Card today!",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-16-int.json" },
      },
      {
        subcategory: "prayer-list",
        name: "Draw Near to God",
        title: "Draw near to God…",
        body: "Create a Prayer Card and spend some time talking with God today!",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-18-int.json" },
      },
      {
        subcategory: "prayer-list",
        name: "God Is Close to You",
        title: "God is close to you!",
        body: "You spent time in prayer! Great job talking with God.",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-10-en.json" },
      },
      {
        subcategory: "prayer-list",
        name: "Enter into God's Presence",
        title: "Enter into God's presence…",
        body: "Spend some time with God today and create a Prayer Card.",
        deeplink: "https://www.bible.com/prayer",
        cta: "Open Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "2025-09-prayer-nurture-workflow-PUSH-17-int.json" },
      },
      // --- Dynamic VOTD variants (liquid tags resolved at send time) ---
      {
        subcategory: "votd-dynamic",
        name: "VOTD: Label + Reference",
        title: "{{guided_prayer_label}}",
        body: "{{votd_reference}}",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: "votd-dynamic",
        name: "VOTD: Label + Reference (Verse Image)",
        title: "{{guided_prayer_label}}",
        body: "{{votd_reference}}",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        iconImageUrl: VERSE_IMAGE_SENTINEL,
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: "votd-dynamic",
        name: "VOTD: Label + Verse Text",
        title: "{{guided_prayer_label}}",
        body: "{{votd_text}}",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: "votd-dynamic",
        name: "VOTD: Label + Verse Text (Verse Image)",
        title: "{{guided_prayer_label}}",
        body: "{{votd_text}}",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        iconImageUrl: VERSE_IMAGE_SENTINEL,
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: "votd-dynamic",
        name: "VOTD: Reference + Label",
        title: "{{votd_reference}}",
        body: "{{guided_prayer_label}}",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
      },
      {
        subcategory: "votd-dynamic",
        name: "VOTD: Reference + Label (Verse Image)",
        title: "{{votd_reference}}",
        body: "{{guided_prayer_label}}",
        deeplink: "https://www.bible.com/guides/1",
        cta: "Open Guided Prayer",
        iconImageUrl: VERSE_IMAGE_SENTINEL,
        actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
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
        funnelStage: "wau",
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
          iconImageUrl: v.iconImageUrl ?? null,
          status: isRewardVariant(v) ? "paused" : "active",
          actionFeatures: v.actionFeatures,
        },
      });
      const reward = isRewardVariant(v) ? " ⏸ paused" : "";
      console.log(`    + ${v.name} [${v.subcategory ?? "—"}]${reward}`);
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
