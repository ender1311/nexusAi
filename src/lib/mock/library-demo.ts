/**
 * Demo-mode content for the six Content libraries. Used only when isDemoMode()
 * is true so the public demo renders populated libraries without a database.
 * Copy is drawn from real YouVersion campaign templates (Sowers/BAS giving,
 * reader habit pushes, resurrection verse content).
 *
 * Each array matches the exact `select` shape its page/query returns, so pages
 * can swap it in for the Prisma result and run their existing grouping logic.
 */

// ── Push Library (/messages) — MessageVariant channel="push" ──────────────
export const demoPushVariants = [
  {
    id: "demo-push-1", name: "Build Your Bible Habit",
    title: "…seek me with all your heart", body: "Build your Bible habit today.",
    deeplink: "youversion://bible", cta: "Open Bible App",
    category: "reader", subcategory: "open-bible", iconImageUrl: null,
    translations: [{ language: "es" }, { language: "pt" }],
  },
  {
    id: "demo-push-2", name: "Pause with God",
    title: "⏸️ Pause with God today.", body: "Open your Bible App to spend time in His Word!",
    deeplink: "youversion://bible", cta: "Open Bible App",
    category: "reader", subcategory: "open-bible", iconImageUrl: null,
    translations: [{ language: "es" }],
  },
  {
    id: "demo-push-3", name: "Pick Up Where You Left Off",
    title: "What was the last verse you read?", body: "Pick up where you left off in God's Word.",
    deeplink: "youversion://bible", cta: "Open Bible App",
    category: "reader", subcategory: "open-bible", iconImageUrl: null,
    translations: [{ language: "es" }, { language: "pt" }, { language: "fr" }],
  },
  {
    id: "demo-push-4", name: "Start a Plan",
    title: "Ready to grow?", body: "Start a guided Bible plan made for where you are today.",
    deeplink: "youversion://plans", cta: "Explore Plans",
    category: "reader", subcategory: "plans", iconImageUrl: null,
    translations: [{ language: "es" }],
  },
  {
    id: "demo-push-5", name: "Become a Sower",
    title: "Take God's Word to the world.", body: "A monthly gift helps distribute Bibles to people who've never had one.",
    deeplink: "youversion://give", cta: "Give Monthly",
    category: "giving", subcategory: "sowers", iconImageUrl: null,
    translations: [],
  },
];

// ── Email Library (/email-library) — MessageVariant channel="email" ───────
export const demoEmailVariants = [
  {
    id: "demo-email-1", name: "Sowers Community Invite",
    subject: "You're invited to join the Sowers Community",
    body: "A gift of $25 a month will distribute over 600 Bible apps this year. Here's what it means to be a Sower of God's Word.",
    deeplink: "https://www.youversion.com/give", cta: "Give a Monthly Gift",
    status: "active", category: "giving", subcategory: "sowers", sortOrder: 0,
    translations: [
      { language: "es", subject: "Te invitamos a unirte a la Comunidad de Sembradores", status: "active" },
    ],
  },
  {
    id: "demo-email-2", name: "Your Bible Plan Is Ready",
    subject: "Your personalized Bible plan is ready",
    body: "We curated a reading plan just for you based on what you've been reading. Jump back in whenever you're ready.",
    deeplink: "https://www.youversion.com/plans", cta: "View My Plan",
    status: "active", category: "engagement", subcategory: "plan-discovery", sortOrder: 0,
    translations: [
      { language: "es", subject: "Tu plan de lectura personalizado está listo", status: "active" },
      { language: "pt", subject: "Seu plano de leitura personalizado está pronto", status: "active" },
    ],
  },
  {
    id: "demo-email-3", name: "Welcome to YouVersion",
    subject: "Welcome — let's build a Bible habit together",
    body: "Join 50M+ readers experiencing Scripture every day. Here are three ways to get started this week.",
    deeplink: "https://www.youversion.com", cta: "Open the App",
    status: "active", category: "engagement", subcategory: "onboarding", sortOrder: 1,
    translations: [],
  },
];

// ── Content Cards (/content-card-library) — channel="content-card" ────────
export const demoContentCardVariants = [
  {
    id: "demo-cc-1", name: "Take God's Word to the World",
    title: "Take God's Word to the world.", body: "Join the Sowers Community! Here's what it means to be a Sower of God's Word.",
    cta: "Tell Me More", deeplink: "youversion://give",
    status: "active", category: "giving", subcategory: "appeal", sortOrder: 0,
  },
  {
    id: "demo-cc-2", name: "World Starving for Truth",
    title: "The world is starving for truth.", body: "And some people may never find it. You can take the truth of God's Word to them by becoming a Sower.",
    cta: "Tell Me More", deeplink: "youversion://give",
    status: "active", category: "giving", subcategory: "appeal", sortOrder: 1,
  },
  {
    id: "demo-cc-3", name: "Keep Your Streak Going",
    title: "You're on a roll.", body: "Come back today to keep your reading streak alive and pick up where you left off.",
    cta: "Continue Reading", deeplink: "youversion://bible",
    status: "active", category: "engagement", subcategory: "habit", sortOrder: 0,
  },
];

// ── Slideups (/slideup-library) — channel="in-app" ────────────────────────
export const demoSlideupVariants = [
  {
    id: "demo-slide-1", name: "Continue Your Plan",
    title: null, body: "Continue your plan — just 5 minutes in God's Word today.",
    deeplink: "youversion://continue-plan", iconImageUrl: null,
    status: "active", category: "engagement", subcategory: "habit", sortOrder: 0,
  },
  {
    id: "demo-slide-2", name: "Verse of the Day",
    title: null, body: "Today's Verse of the Day is ready. Take a moment with it.",
    deeplink: "youversion://votd", iconImageUrl: null,
    status: "active", category: "engagement", subcategory: "votd", sortOrder: 1,
  },
  {
    id: "demo-slide-3", name: "Give Nudge",
    title: null, body: "Become a Sower — help put God's Word in more hands this year.",
    deeplink: "youversion://give", iconImageUrl: null,
    status: "active", category: "giving", subcategory: "sowers", sortOrder: 0,
  },
];

// ── Modal IAMs (/modal-iam-library) — channel="modal-iam" ─────────────────
export const demoModalIamVariants = [
  {
    id: "demo-modal-1", name: "Sowers Invite",
    title: "You're invited to join the Sowers Community!", body: "A gift of $25 a month will distribute over 600 Bible apps this year.",
    cta: "Give a Monthly Gift", deeplink: "youversion://give", iconImageUrl: null,
    status: "active", category: "giving", subcategory: "sowers", sortOrder: 0,
  },
  {
    id: "demo-modal-2", name: "Unlock Guided Plans",
    title: "Grow deeper with guided plans", body: "Get personalized reading plans, streaks, and daily reminders tailored to you.",
    cta: "Explore Plans", deeplink: "youversion://plans", iconImageUrl: null,
    status: "active", category: "engagement", subcategory: "plan-discovery", sortOrder: 0,
  },
];

// ── Verse Library (/push-library) — CampaignContent, campaign resurrection-push
type DemoCampaignRow = {
  id: string;
  contentType: "a-title" | "b-title" | "verse-text";
  language: string;
  usfmReference: string;
  usfmHuman: string;
  title: string | null;
  body: string | null;
};

const VERSES: Array<{ ref: string; human: string; aTitle: string; bTitle: string; text: string }> = [
  { ref: "MAT.28.6", human: "Matthew 28:6", aTitle: "He is not here", bTitle: "He has risen", text: "He is not here; he has risen, just as he said. Come and see the place where he lay." },
  { ref: "JHN.11.25", human: "John 11:25", aTitle: "The resurrection and the life", bTitle: "I am the resurrection", text: "Jesus said to her, “I am the resurrection and the life. The one who believes in me will live, even though they die.”" },
  { ref: "LUK.24.6", human: "Luke 24:6", aTitle: "He is risen", bTitle: "Remember what he told you", text: "He is not here; he has risen! Remember how he told you, while he was still with you in Galilee." },
  { ref: "ROM.6.4", human: "Romans 6:4", aTitle: "Raised to new life", bTitle: "Walk in newness of life", text: "We were therefore buried with him through baptism into death in order that, just as Christ was raised from the dead, we too may live a new life." },
  { ref: "1CO.15.20", human: "1 Corinthians 15:20", aTitle: "Christ has been raised", bTitle: "Firstfruits of those asleep", text: "But Christ has indeed been raised from the dead, the firstfruits of those who have fallen asleep." },
];

export const demoVerseActiveRows: DemoCampaignRow[] = VERSES.flatMap((v, i) => [
  { id: `demo-cc-a-${i}`, contentType: "a-title" as const, language: "en", usfmReference: v.ref, usfmHuman: v.human, title: v.aTitle, body: null },
  { id: `demo-cc-b-${i}`, contentType: "b-title" as const, language: "en", usfmReference: v.ref, usfmHuman: v.human, title: v.bTitle, body: null },
  { id: `demo-cc-v-${i}`, contentType: "verse-text" as const, language: "en", usfmReference: v.ref, usfmHuman: v.human, title: null, body: v.text },
]);

// Language rollup shown in the selector: English complete, Spanish partial.
export const demoVerseGroupResult = [
  { language: "en", _count: { id: demoVerseActiveRows.length } },
  { language: "es", _count: { id: Math.floor(demoVerseActiveRows.length * 0.6) } },
];
