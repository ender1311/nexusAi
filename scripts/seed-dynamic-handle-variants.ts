// Seeds the dynamic-handle giving push library (agentId = null = library templates).
//
// Two experiment families, both under category "giving" / subcategory "dynamic-handle":
//   1. Never-givers (7 variants) — identical copy, different opening ask ($5–$100)
//      carried in actionFeatures.givingHandleDefaultUsd. Users with no gift history
//      collapse every strategy to this default, so the bandit (LinUCB context vector)
//      learns the best opening ask per user / look-alike cohort.
//   2. Single-gift givers (4 variants) — identical copy, different anchor strategy
//      (avg / recent / max / blend). Here history exists, so the bandit learns which
//      gift signal best predicts a recurring conversion.
//
// SAFETY: dry-run by default — prints the plan and writes NOTHING. Pass --commit to
// insert. Idempotent: skips any entry whose name already exists. Create-only.
// prisma targets the .env.local DB (production) per CLAUDE.md — review the dry-run
// before --commit.
//
// NOTE: attaching these to an agent creates clones (sourceTemplateId set) that do NOT
// carry actionFeatures/subcategory until the sync-template-variants cron propagates
// them. Trigger that cron (or wait for its schedule) after building a giving agent.
import { prisma } from "@/lib/db";

type ActionFeatures = {
  tone: string;
  hasPersonalization: boolean;
  ctaType: string;
  messageLengthBucket: string;
  givingHandleStrategy: "avg-gift" | "recent-gift" | "max-gift" | "blend";
  givingFrequency: "monthly" | "once";
  givingHandleDefaultUsd?: number;
};

type Entry = {
  name: string;
  title: string;
  body: string;
  actionFeatures: ActionFeatures;
};

const COMMIT = process.argv.includes("--commit");

// ── Family 1: never-givers — experiment on the opening ask ($5–$100) ──────────
const NEVER_GIVER_TITLE = "Become a Sower";
const NEVER_GIVER_BODY =
  "{{ask}} a month helps put the free Bible App in {{bibles}} more hands this year. Start your monthly gift?";
const NEVER_GIVER_AMOUNTS = [5, 10, 15, 25, 50, 75, 100];

const neverGiverEntries: Entry[] = NEVER_GIVER_AMOUNTS.map((usd) => ({
  name: `Dynamic Handle — Sower Ask $${usd}`,
  title: NEVER_GIVER_TITLE,
  body: NEVER_GIVER_BODY,
  actionFeatures: {
    tone: "milestone",
    hasPersonalization: true,
    ctaType: "deeplink",
    messageLengthBucket: "short",
    givingHandleStrategy: "blend",
    givingFrequency: "monthly",
    givingHandleDefaultUsd: usd,
  },
}));

// ── Family 2: single-gift givers — experiment on the anchor strategy ──────────
const SINGLE_GIFT_TITLE = "Turn your gift into monthly impact";
const SINGLE_GIFT_BODY =
  "You've given before — thank you. {{ask}} a month would reach {{bibles}} people with Scripture all year. Make it recurring?";
const STRATEGIES: Array<{ strategy: ActionFeatures["givingHandleStrategy"]; label: string }> = [
  { strategy: "avg-gift", label: "avg gift" },
  { strategy: "recent-gift", label: "recent gift" },
  { strategy: "max-gift", label: "max gift" },
  { strategy: "blend", label: "blend" },
];

const singleGiftEntries: Entry[] = STRATEGIES.map(({ strategy, label }) => ({
  name: `Dynamic Handle — Recurring (${label})`,
  title: SINGLE_GIFT_TITLE,
  body: SINGLE_GIFT_BODY,
  actionFeatures: {
    tone: "question",
    hasPersonalization: true,
    ctaType: "deeplink",
    messageLengthBucket: "medium",
    givingHandleStrategy: strategy,
    givingFrequency: "monthly",
  },
}));

const ENTRIES: Entry[] = [...neverGiverEntries, ...singleGiftEntries];

async function main() {
  console.log(`Planning ${ENTRIES.length} dynamic-handle variants (category=giving, subcategory=dynamic-handle).`);

  // Find or create the library "giving" push message (agentId = null).
  let message = await prisma.message.findFirst({
    where: { agentId: null, channel: "push", variants: { some: { category: "giving" } } },
  });
  if (!message) {
    if (!COMMIT) {
      console.log(`[dry-run] would create library message "giving Templates"`);
    } else {
      message = await prisma.message.create({
        data: { agentId: null, name: "giving Templates", channel: "push" },
      });
      console.log(`Created message ${message.id}`);
    }
  }

  const existing = message
    ? await prisma.messageVariant.findMany({
        where: { message: { agentId: null, channel: "push" } },
        select: { name: true },
      })
    : [];
  const existingNames = new Set(existing.map((v) => v.name));

  let created = 0;
  let skipped = 0;
  for (const e of ENTRIES) {
    if (existingNames.has(e.name)) {
      skipped++;
      console.log(`  skip (exists): ${e.name}`);
      continue;
    }
    if (!COMMIT) {
      const handle = e.actionFeatures.givingHandleDefaultUsd
        ? `default $${e.actionFeatures.givingHandleDefaultUsd}`
        : `strategy ${e.actionFeatures.givingHandleStrategy}`;
      console.log(`  [dry-run] would insert: ${e.name} (${handle})`);
      created++;
      continue;
    }
    await prisma.messageVariant.create({
      data: {
        messageId: message!.id,
        name: e.name,
        title: e.title,
        body: e.body,
        deeplink: null, // resolved per-user at send time via the giving-link engine
        category: "giving",
        subcategory: "dynamic-handle",
        status: "active",
        actionFeatures: e.actionFeatures,
      },
    });
    created++;
  }

  console.log(
    `${COMMIT ? "Inserted" : "[dry-run] would insert"} ${created}, skipped ${skipped} (already present).`,
  );
  if (!COMMIT) console.log("Re-run with --commit to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
