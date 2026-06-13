/**
 * Import slideup (in-app message) variants from Dropbox campaign folders.
 *
 * Usage:
 *   bun run scripts/import-slideup-library.ts [--dry-run] [--year 2026]
 *
 * Reads IAM JSON files from:
 *   <DROPBOX_CAMPAIGNS>/YEAR/CAMPAIGN/in-app message/CAMPAIGN-IAM-LANG.json
 *
 * For each campaign it creates (or skips if already exists by name):
 * - One Message record (agentId: null, channel: "in-app")
 * - One MessageVariant per campaign (English body, null title = slideup-only)
 * - MessageVariantTranslation rows for each non-English language
 *
 * Category is derived from the campaign folder name prefix (see CATEGORY_MAP below).
 */

import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/db";

const DROPBOX_BASE = path.join(
  process.env.HOME ?? "",
  "Library/CloudStorage/Dropbox-Life.Church/Ion/Interactive/Design/Clint",
  "Clint McManaman’s files/Shared/YouVersionTeam/Communications/Campaigns",
);

const CATEGORY_MAP: Array<{ pattern: RegExp; category: string; subcategory: string }> = [
  { pattern: /giving/i, category: "giving", subcategory: "appeal" },
  { pattern: /easter|palm.sunday|good.friday|p.s.p.scoa|ressurre/i, category: "seasonal", subcategory: "easter" },
  { pattern: /christmas/i, category: "seasonal", subcategory: "christmas" },
  { pattern: /advent|lent/i, category: "seasonal", subcategory: "lent-advent" },
  { pattern: /plans|bioy|featured/i, category: "bible-plans", subcategory: "featured-plans" },
  { pattern: /challenge/i, category: "bible-plans", subcategory: "challenge" },
  { pattern: /discovery|journeys/i, category: "bible-plans", subcategory: "discovery" },
  { pattern: /prayer/i, category: "prayer", subcategory: "prayer" },
  { pattern: /share.*faith|faith.*share/i, category: "community", subcategory: "sharing" },
  { pattern: /survey/i, category: "community", subcategory: "survey" },
  { pattern: /listen|feature|education/i, category: "feature-education", subcategory: "engagement" },
  { pattern: /sowers/i, category: "giving", subcategory: "sowers" },
];

function deriveCategory(campaignName: string): { category: string; subcategory: string } {
  for (const { pattern, category, subcategory } of CATEGORY_MAP) {
    if (pattern.test(campaignName)) return { category, subcategory };
  }
  return { category: "editorial", subcategory: "general" };
}

interface IamJson {
  message?: string;
}

function readIamFiles(iamDir: string): Map<string, string> {
  const byLang = new Map<string, string>();
  for (const file of fs.readdirSync(iamDir)) {
    if (!file.endsWith(".json")) continue;
    const match = file.match(/-IAM-([a-z]{2}(?:_[A-Z]{2})?)\.json$/i);
    if (!match) continue;
    const lang = match[1];
    try {
      const data = JSON.parse(fs.readFileSync(path.join(iamDir, file), "utf8")) as IamJson;
      if (data.message) byLang.set(lang, data.message);
    } catch {
      // skip malformed files
    }
  }
  return byLang;
}

async function importYear(year: string, dryRun: boolean): Promise<void> {
  const yearDir = path.join(DROPBOX_BASE, year);
  if (!fs.existsSync(yearDir)) {
    console.log(`Year directory not found: ${yearDir}`);
    return;
  }

  const campaigns = fs.readdirSync(yearDir).filter((d) => {
    const full = path.join(yearDir, d);
    return !d.startsWith(".") && fs.statSync(full).isDirectory();
  });

  let created = 0;
  let skipped = 0;
  let noIam = 0;

  for (const campaign of campaigns) {
    const iamDir = path.join(yearDir, campaign, "in-app message");
    if (!fs.existsSync(iamDir)) {
      noIam++;
      continue;
    }

    const byLang = readIamFiles(iamDir);
    const englishBody = byLang.get("en");
    if (!englishBody) {
      console.warn(`  [skip] ${campaign}: no English IAM body`);
      skipped++;
      continue;
    }

    // Derive deeplink from liquid_link.html (extract first URL after 'en' block)
    let deeplink: string | null = null;
    const linkFile = path.join(iamDir, "liquid_link.html");
    if (fs.existsSync(linkFile)) {
      const html = fs.readFileSync(linkFile, "utf8");
      const enMatch = html.match(/contains 'en'[^%]*%\}[\s\n]*(https?:\/\/[^\s\n{%]+)/);
      if (enMatch) deeplink = enMatch[1].trim();
    }

    const variantName = campaign;
    const { category, subcategory } = deriveCategory(campaign);

    // Check if already exists
    const existing = await prisma.messageVariant.findFirst({
      where: { name: variantName, message: { agentId: null, channel: "in-app" } },
    });
    if (existing) {
      console.log(`  [exists] ${campaign}`);
      skipped++;
      continue;
    }

    console.log(`  [import] ${campaign} → ${category}/${subcategory}`);
    console.log(`           EN: ${englishBody.slice(0, 80)}...`);
    if (deeplink) console.log(`           link: ${deeplink}`);
    console.log(`           langs: ${Array.from(byLang.keys()).join(", ")}`);

    if (dryRun) {
      created++;
      continue;
    }

    // Find or create the message bucket for this category (same lookup as the
    // library route so both paths always share the same Message record).
    let message = await prisma.message.findFirst({
      where: { agentId: null, channel: "in-app", variants: { some: { category } } },
    });
    if (!message) {
      message = await prisma.message.create({
        data: { agentId: null, name: `${category} Slideup Templates`, channel: "in-app" },
      });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: variantName,
        title: null, // slideup-only: no push title
        body: englishBody,
        deeplink,
        category,
        subcategory,
        status: "active",
      },
    });

    // Non-English translations
    const translationData = Array.from(byLang.entries())
      .filter(([lang]) => lang !== "en")
      .map(([lang, body]) => ({
        messageVariantId: variant.id,
        language: lang,
        body,
        status: "active",
        source: "import:dropbox",
        sourceFile: `${campaign}/in-app message/${campaign}-IAM-${lang}.json`,
      }));

    if (translationData.length > 0) {
      await prisma.messageVariantTranslation.createMany({ data: translationData });
    }

    created++;
    console.log(`           ✓ created variant ${variant.id} + ${translationData.length} translations`);
  }

  console.log(`\n${year}: ${created} created, ${skipped} skipped, ${noIam} no IAM folder`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yearArg = args.find((a) => a.startsWith("--year="))?.split("=")[1]
    ?? args[args.indexOf("--year") + 1];
  const years = yearArg ? [yearArg] : ["2026"];

  console.log(`Slideup library import — ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Base path: ${DROPBOX_BASE}\n`);

  for (const year of years) {
    console.log(`=== ${year} ===`);
    await importYear(year, dryRun);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
