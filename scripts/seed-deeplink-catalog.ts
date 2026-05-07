/**
 * Seed script: Deeplink Catalog
 *
 * Seeds the Deeplink table with entries relevant to the 5 Nexus push categories
 * (reader, plans, votd, guided-scripture, guided-prayer).
 *
 * Source data is inlined from wayfinder/src/lib/data/deeplink-inventory-data.ts
 * (filtered to the 4 mapped wayfinder categories + a manual votd entry).
 *
 * Filtering rules applied at source:
 *  - Only verification: 'Working' | 'Not Verified' (excludes 'Broken')
 *  - Excludes isReferenceOnly entries
 *  - Excludes categories not mapped to a Nexus category
 *
 * Subcategory mapping:
 *  - scripture-bible-reader         → open-bible
 *  - bible-reader-no-position       → open-bible
 *  - audio-bible                    → audio-bible
 *  - Any Scripture id with 'verse'  → specific-verse
 *  - Any Reading Plans with 'my-plans' in id → my-plans
 *  - Any Reading Plans with 'saved' in id    → saved-plans
 *  - Any Reading Plans without my/saved      → find-plans
 *  - Any Stories & Guided Scripture entry   → todays-story
 *  - Any Prayer id with 'guided'    → guided-prayer
 *  - Any Prayer without 'guided'    → prayer-list
 *
 * Usage: bun run scripts/seed-deeplink-catalog.ts
 * Idempotent: upserts by wayfinderId.
 */

import { prisma } from "../src/lib/db";

type WayfinderCategory =
  | "Scripture"
  | "Reading Plans"
  | "Stories & Guided Scripture"
  | "Prayer";

type SourceEntry = {
  id: string;
  category: WayfinderCategory;
  label: string;
  description: string;
  urlTemplate: string;
};

// ── Inlined from wayfinder/src/lib/data/deeplink-inventory-data.ts ────────────
// Filtered: verification !== 'Broken', !isReferenceOnly, category in mapped set.
const SOURCE_ENTRIES: SourceEntry[] = [
  // Scripture — Working / Not Verified
  {
    id: "scripture-bible-reader",
    category: "Scripture",
    label: "Bible Reader",
    description: "Open a specific Bible passage in the reader.",
    urlTemplate: "https://www.bible.com/bible/{version_id}/{USFM}",
  },
  {
    id: "audio-bible",
    category: "Scripture",
    label: "Audio Bible",
    description: "Open the Bible reader with audio playback.",
    urlTemplate: "https://www.bible.com/bible/{version_id}/{USFM}?audio=true",
  },
  {
    id: "bible-reader-no-position",
    category: "Scripture",
    label: "Bible Reader (Keep Position)",
    description: "Open the Bible reader at the user's last-read position.",
    urlTemplate: "https://www.bible.com/bible/?suppress_branch_meta=true",
  },
  {
    id: "native-bible-reader",
    category: "Scripture",
    label: "Native Bible Reader (Push/In-App only)",
    description: "Open the native Bible reader using the youversion:// scheme.",
    urlTemplate: "youversion://bible",
  },
  {
    id: "bible-search",
    category: "Scripture",
    label: "Bible Search",
    description: "Open Bible search, optionally pre-filled with a query.",
    urlTemplate: "https://www.bible.com/search/bible",
  },
  {
    id: "bible-versions",
    category: "Scripture",
    label: "Bible Versions",
    description: "Open the Bible versions browser.",
    urlTemplate: "https://www.bible.com/versions",
  },
  {
    id: "bible-languages",
    category: "Scripture",
    label: "Bible Languages",
    description: "Open the Bible language selector.",
    urlTemplate: "https://www.bible.com/languages",
  },
  {
    id: "bible-language-tag",
    category: "Scripture",
    label: "Bible Versions by Language",
    description: "Open Bible versions filtered to a specific language.",
    urlTemplate: "https://www.bible.com/languages/{LANGUAGE_TAG}",
  },

  // Reading Plans — all Not Verified (none Broken)
  {
    id: "find-plans",
    category: "Reading Plans",
    label: "Find Plans",
    description: "Open the reading plans discovery view.",
    urlTemplate: "https://www.bible.com/reading-plans",
  },
  {
    id: "specific-plan",
    category: "Reading Plans",
    label: "Specific Reading Plan",
    description: "Open a specific reading plan.",
    urlTemplate: "https://www.bible.com/reading-plans/{PLAN_ID}",
  },
  {
    id: "plan-day",
    category: "Reading Plans",
    label: "Specific Plan Day",
    description: "Open a specific day of a reading plan.",
    urlTemplate: "https://www.bible.com/reading-plans/{PLAN_ID}/day/{DAY}",
  },
  {
    id: "plan-collection",
    category: "Reading Plans",
    label: "Plan Collection",
    description: "Open a specific reading plan collection.",
    urlTemplate: "https://www.bible.com/reading-plans-collection/{COLLECTION_ID}",
  },
  {
    id: "saved-plans",
    category: "Reading Plans",
    label: "Saved Plans",
    description: "Open the user's saved plans.",
    urlTemplate: "https://www.bible.com/saved_plans",
  },
  {
    id: "my-plans",
    category: "Reading Plans",
    label: "My Plans",
    description: "Open the user's active plans.",
    urlTemplate: "https://www.bible.com/my-plans",
  },

  // Prayer — all Not Verified
  {
    id: "prayer-view",
    category: "Prayer",
    label: "Prayer View",
    description: "Open the prayer section.",
    urlTemplate: "https://www.bible.com/prayer",
  },
  {
    id: "prayer-list",
    category: "Prayer",
    label: "Prayer List",
    description: "Open the user's prayer list.",
    urlTemplate: "https://www.bible.com/prayers",
  },
  {
    id: "prayer-add",
    category: "Prayer",
    label: "Add Prayer",
    description: "Open the add-prayer screen, optionally pre-filled.",
    urlTemplate: "https://www.bible.com/prayers/add",
  },
  {
    id: "guided-prayer",
    category: "Prayer",
    label: "Guided Prayer",
    description: "Open today's guided prayer (guide_id 1).",
    urlTemplate: "https://www.bible.com/guides/{GUIDE_ID}",
  },

  // Stories & Guided Scripture — votd is Broken so excluded; votd-image-share included
  {
    id: "guided-scripture",
    category: "Stories & Guided Scripture",
    label: "Guided Scripture (Today's)",
    description: "Open today's guided scripture story.",
    urlTemplate: "https://www.bible.com/stories",
  },
  {
    id: "guided-scripture-id",
    category: "Stories & Guided Scripture",
    label: "Specific Guided Scripture",
    description: "Open a specific guided scripture story by ID.",
    urlTemplate: "https://www.bible.com/stories/{STORY_ID}",
  },
  {
    id: "votd-image-share",
    category: "Stories & Guided Scripture",
    label: "Verse Image Share",
    description: "Open the verse image share/save sheet for a specific verse image.",
    urlTemplate: "https://www.bible.com/{LANGUAGE_TAG}/verse-of-the-day/{USFM}/{IMAGE_ID}",
  },
];

// ── Category → Nexus category mapping ────────────────────────────────────────
const NEXUS_CATEGORY: Record<WayfinderCategory, string> = {
  Scripture: "reader",
  "Reading Plans": "plans",
  "Stories & Guided Scripture": "guided-scripture",
  Prayer: "guided-prayer",
};

function getNexusSubcategory(entry: SourceEntry): string {
  const id = entry.id;
  const cat = entry.category;

  if (cat === "Scripture") {
    if (id === "scripture-bible-reader") return "open-bible";
    if (id === "bible-reader-no-position") return "open-bible";
    if (id === "audio-bible") return "audio-bible";
    if (id.includes("verse")) return "specific-verse";
    return "open-bible";
  }

  if (cat === "Reading Plans") {
    if (id.includes("my-plans")) return "my-plans";
    if (id.includes("saved")) return "saved-plans";
    return "find-plans";
  }

  if (cat === "Stories & Guided Scripture") {
    return "todays-story";
  }

  if (cat === "Prayer") {
    if (id.includes("guided")) return "guided-prayer";
    return "prayer-list";
  }

  return "unknown";
}

// Manual votd entry (the votd entry in wayfinder has verification: 'Broken')
type ManualEntry = {
  wayfinderId: string;
  category: string;
  subcategory: string;
  label: string;
  description: string;
  urlTemplate: string;
};

const MANUAL_ENTRIES: ManualEntry[] = [
  {
    wayfinderId: "votd-page",
    category: "votd",
    subcategory: "votd-page",
    label: "Verse of the Day",
    description: "Open the Verse of the Day view.",
    urlTemplate: "https://www.bible.com/verse-of-the-day",
  },
];

async function main() {
  console.log("🌱 Seeding deeplink catalog...\n");

  let upserted = 0;

  // ── Seed from inlined wayfinder source ────────────────────────────────────
  for (const entry of SOURCE_ENTRIES) {
    const category = NEXUS_CATEGORY[entry.category];
    const subcategory = getNexusSubcategory(entry);

    await prisma.deeplink.upsert({
      where: { wayfinderId: entry.id },
      update: {
        category,
        subcategory,
        label: entry.label,
        description: entry.description,
        urlTemplate: entry.urlTemplate,
      },
      create: {
        wayfinderId: entry.id,
        category,
        subcategory,
        label: entry.label,
        description: entry.description,
        urlTemplate: entry.urlTemplate,
        sortOrder: 0,
      },
    });

    console.log(`  + ${entry.id} → ${category}/${subcategory}`);
    upserted++;
  }

  // ── Seed manual entries ────────────────────────────────────────────────────
  for (const entry of MANUAL_ENTRIES) {
    await prisma.deeplink.upsert({
      where: { wayfinderId: entry.wayfinderId },
      update: {
        category: entry.category,
        subcategory: entry.subcategory,
        label: entry.label,
        description: entry.description,
        urlTemplate: entry.urlTemplate,
      },
      create: {
        wayfinderId: entry.wayfinderId,
        category: entry.category,
        subcategory: entry.subcategory,
        label: entry.label,
        description: entry.description,
        urlTemplate: entry.urlTemplate,
        sortOrder: 0,
      },
    });
    console.log(`  + ${entry.wayfinderId} → ${entry.category}/${entry.subcategory} (manual)`);
    upserted++;
  }

  console.log(`\n✅ Done — ${upserted} deeplinks upserted.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
