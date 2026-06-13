/**
 * Import modal IAM variants from Dropbox campaign folders.
 *
 * Usage:
 *   bun run scripts/import-modal-iam-library.ts [--dry-run] [--year 2025]
 *
 * Reads IAM JSON files from any of:
 *   <DROPBOX_CAMPAIGNS>/YEAR/CAMPAIGN/in-app message/CAMPAIGN-IAM-LANG.json
 *   <DROPBOX_CAMPAIGNS>/YEAR/CAMPAIGN/iam/CAMPAIGN-IAM-LANG.json
 *   <DROPBOX_CAMPAIGNS>/YEAR/CAMPAIGN/iam1/ (etc.)
 *
 * Modal IAMs are identified by the presence of a `title` field in the JSON
 * (as opposed to slideup-only IAMs which have only `message`).
 *
 * JSON format: { title, message, cta [or cta1/main_cta], [cta2] }
 *
 * For each campaign it creates (or skips if already exists by name):
 * - One Message record (agentId: null, channel: "modal-iam")
 * - One MessageVariant per distinct IAM (numbered variants get a suffix)
 * - MessageVariantTranslation rows for each non-English language
 *
 * Category is derived from the campaign folder name prefix.
 * Image URL is extracted from the IAM HTML template (braze-images.com CDN URL).
 * Deeplink is extracted from liquid_link.html if present.
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
  { pattern: /sowers/i,                                                             category: "giving",            subcategory: "sowers" },
  { pattern: /giving.tuesday/i,                                                     category: "giving",            subcategory: "giving-tuesday" },
  { pattern: /eoy.giving|end.of.year/i,                                             category: "giving",            subcategory: "year-end" },
  { pattern: /giving|donate|donation/i,                                             category: "giving",            subcategory: "appeal" },
  { pattern: /easter|palm.sunday|good.friday|pascoa|pasqua|resurrection|holy.week/i, category: "seasonal",         subcategory: "easter" },
  { pattern: /lent.begins|lent$/i,                                                  category: "seasonal",          subcategory: "lent-advent" },
  { pattern: /advent/i,                                                             category: "seasonal",          subcategory: "lent-advent" },
  { pattern: /christmas|christmas.story|christmas.eve/i,                            category: "seasonal",          subcategory: "christmas" },
  { pattern: /guided.scripture|daily.refresh|parables|transformation|beatitudes|peace|million.*bible/i, category: "guided-scripture", subcategory: "guided-scripture" },
  { pattern: /prayer|week.of.prayer/i,                                              category: "prayer",            subcategory: "prayer" },
  { pattern: /bioy|bible.in.one.year|challenge|mid.year.challenge/i,               category: "bible-plans",       subcategory: "challenge" },
  { pattern: /featured.plans|plan.cards/i,                                          category: "bible-plans",       subcategory: "featured-plans" },
  { pattern: /survey/i,                                                             category: "community",         subcategory: "survey" },
  { pattern: /share|gather|story|church|bafk|billion/i,                            category: "community",         subcategory: "sharing" },
  { pattern: /study.notes|bible.loop|nrsv|qr.code|tappable|cross.reference|mode.[0-9]/i, category: "feature-education", subcategory: "new-feature" },
];

function deriveCategory(campaignName: string): { category: string; subcategory: string } {
  for (const { pattern, category, subcategory } of CATEGORY_MAP) {
    if (pattern.test(campaignName)) return { category, subcategory };
  }
  return { category: "editorial", subcategory: "general" };
}

const IAM_SUBFOLDERS = ["in-app message", "in-app message copy", "in-app event", "iam", "iam1", "iam2", "IAM"];

interface IamJson {
  title?: string;
  message?: string;
  cta?: string;
  cta1?: string;
  main_cta?: string;
  cta2?: string;
  [key: string]: unknown;
}

function extractCta(data: IamJson): string | null {
  return (data.cta ?? data.cta1 ?? data.main_cta ?? "").trim() || null;
}

/** Returns true if a JSON file is a modal IAM (has title). */
function isModalIam(data: IamJson): boolean {
  return typeof data.title === "string" && data.title.trim().length > 0;
}

/**
 * Detect the language from a filename.
 * Returns "en" for standard English files, a lang code, or null if unknown.
 * English patterns: -en.json, -en_GB.json, no-lang-suffix (fallback).
 */
function detectLang(filename: string): string | null {
  // Standard pattern: campaign-IAM-lang.json
  const m = filename.match(/-([a-z]{2}(?:_[A-Z]{2})?)\.json$/);
  if (m) return m[1];
  // No lang suffix — treat as English
  if (filename.endsWith(".json")) return "en";
  return null;
}

/** Extract braze-images.com URL from an IAM HTML file. */
function extractImageUrl(htmlPath: string): string | null {
  if (!fs.existsSync(htmlPath)) return null;
  try {
    const html = fs.readFileSync(htmlPath, "utf8");
    const m = html.match(/https:\/\/braze-images\.com\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp)/i);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

/** Extract English deeplink from liquid_link.html. */
function extractDeeplink(iamDir: string): string | null {
  const linkFile = path.join(iamDir, "liquid_link.html");
  if (!fs.existsSync(linkFile)) return null;
  try {
    const html = fs.readFileSync(linkFile, "utf8");
    // Try Liquid conditional en block first
    const enMatch = html.match(/contains 'en'[^%]*%\}[\s\n]*(https?:\/\/[^\s\n{%]+)/);
    if (enMatch) return enMatch[1].trim();
    // Plain URL (no Liquid)
    const urlMatch = html.match(/https?:\/\/[^\s<>"]+/);
    return urlMatch ? urlMatch[0].trim() : null;
  } catch {
    return null;
  }
}

interface ModalEntry {
  variantSuffix: string; // "" for single, " #1" / " #2" for numbered
  title: string;
  body: string;
  cta: string | null;
  deeplink: string | null;
  imageUrl: string | null;
  translations: Map<string, { title: string; body: string }>;
}

/**
 * Read all modal IAM entries from an IAM subfolder.
 * Groups files by variant number (IAM-1-*, IAM-2-*) or treats as single.
 */
function readIamDir(iamDir: string): ModalEntry[] {
  const files = fs.readdirSync(iamDir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  if (files.length === 0) return [];

  // Group by variant number: detect if filenames have -IAM-1- or -IAM-2- pattern
  const variantGroups = new Map<string, Map<string, IamJson>>();

  for (const file of files) {
    const filePath = path.join(iamDir, file);
    let data: IamJson;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8")) as IamJson;
    } catch {
      continue;
    }
    if (!isModalIam(data)) continue;

    const lang = detectLang(file);
    if (!lang) continue;

    // Try to detect variant number: -IAM-1- or -IAM-2- pattern
    const numMatch = file.match(/-IAM-(\d+)-/i) ?? file.match(/-(\d+)-IAM-/i);
    const variantKey = numMatch ? numMatch[1] : "0";

    if (!variantGroups.has(variantKey)) variantGroups.set(variantKey, new Map());
    variantGroups.get(variantKey)!.set(lang, data);
  }

  if (variantGroups.size === 0) return [];

  const isMultiVariant = variantGroups.size > 1;
  const sortedKeys = Array.from(variantGroups.keys()).sort();
  const deeplink = extractDeeplink(iamDir);

  // Find image URL from any HTML file in this folder
  const htmlFiles = fs.readdirSync(iamDir).filter((f) => f.endsWith(".html") && !f.startsWith("."));
  let imageUrl: string | null = null;
  for (const htmlFile of htmlFiles) {
    imageUrl = extractImageUrl(path.join(iamDir, htmlFile));
    if (imageUrl) break;
  }

  const entries: ModalEntry[] = [];

  for (const key of sortedKeys) {
    const byLang = variantGroups.get(key)!;
    const enData = byLang.get("en") ?? byLang.get("en_GB");
    if (!enData) {
      // No English — try to find the canonical file (no-suffix = English)
      const fallback = Array.from(byLang.values())[0];
      if (!fallback) continue;
      const title = fallback.title?.trim();
      const body = fallback.message?.trim();
      if (!title || !body) continue;
      entries.push({
        variantSuffix: isMultiVariant ? ` #${key}` : "",
        title,
        body,
        cta: extractCta(fallback),
        deeplink,
        imageUrl,
        translations: new Map(),
      });
      continue;
    }

    const title = enData.title?.trim();
    const body = enData.message?.trim();
    if (!title || !body) continue;

    const translations = new Map<string, { title: string; body: string }>();
    for (const [lang, data] of byLang.entries()) {
      if (lang === "en" || lang === "en_GB") continue;
      const tTitle = data.title?.trim();
      const tBody = data.message?.trim();
      if (tTitle && tBody) translations.set(lang, { title: tTitle, body: tBody });
    }

    entries.push({
      variantSuffix: isMultiVariant ? ` #${key}` : "",
      title,
      body,
      cta: extractCta(enData),
      deeplink,
      imageUrl,
      translations,
    });
  }

  return entries;
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
    const campaignPath = path.join(yearDir, campaign);

    // Collect all modal IAM entries across all IAM subfolders
    const allEntries: Array<{ entry: ModalEntry; iamDir: string }> = [];
    for (const sub of IAM_SUBFOLDERS) {
      const iamDir = path.join(campaignPath, sub);
      if (!fs.existsSync(iamDir)) continue;
      const entries = readIamDir(iamDir);
      for (const entry of entries) allEntries.push({ entry, iamDir: sub });
    }

    if (allEntries.length === 0) {
      noIam++;
      continue;
    }

    const { category, subcategory } = deriveCategory(campaign);

    for (const { entry } of allEntries) {
      const variantName = `${campaign}${entry.variantSuffix}`;

      const existing = await prisma.messageVariant.findFirst({
        where: { name: variantName, message: { agentId: null, channel: "modal-iam" } },
      });
      if (existing) {
        console.log(`  [exists] ${variantName}`);
        skipped++;
        continue;
      }

      console.log(`  [import] ${variantName} → ${category}/${subcategory}`);
      console.log(`           title: ${entry.title.slice(0, 70)}`);
      console.log(`           body:  ${entry.body.slice(0, 70)}...`);
      if (entry.cta) console.log(`           cta:   ${entry.cta}`);
      if (entry.deeplink) console.log(`           link:  ${entry.deeplink}`);
      if (entry.imageUrl) console.log(`           img:   ${entry.imageUrl.slice(0, 80)}`);
      console.log(`           langs: ${Array.from(entry.translations.keys()).join(", ") || "(en only)"}`);

      if (dryRun) {
        created++;
        continue;
      }

      // Find or create the Message bucket for this category
      let message = await prisma.message.findFirst({
        where: { agentId: null, channel: "modal-iam", variants: { some: { category } } },
      });
      if (!message) {
        message = await prisma.message.create({
          data: { agentId: null, name: `${category} Modal IAM Templates`, channel: "modal-iam" },
        });
      }

      const variant = await prisma.messageVariant.create({
        data: {
          messageId: message.id,
          name: variantName,
          title: entry.title,
          body: entry.body,
          deeplink: entry.deeplink,
          iconImageUrl: entry.imageUrl,
          category,
          subcategory,
          status: "active",
        },
      });

      const translationData = Array.from(entry.translations.entries()).map(([lang, t]) => ({
        messageVariantId: variant.id,
        language: lang,
        title: t.title,
        body: t.body,
        status: "active",
        source: "import:dropbox",
        sourceFile: `${year}/${campaign}`,
      }));

      if (translationData.length > 0) {
        await prisma.messageVariantTranslation.createMany({ data: translationData });
      }

      created++;
      console.log(`           ✓ created variant ${variant.id} + ${translationData.length} translations`);
    }
  }

  console.log(`\n${year}: ${created} created, ${skipped} skipped, ${noIam} no modal IAM`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yearFlagIdx = args.indexOf("--year");
  const yearArg = args.find((a) => a.startsWith("--year="))?.split("=")[1]
    ?? (yearFlagIdx !== -1 ? args[yearFlagIdx + 1] : undefined);
  const years = yearArg ? [yearArg] : ["2025", "2026"];

  console.log(`Modal IAM library import — ${dryRun ? "DRY RUN" : "LIVE"}`);
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
