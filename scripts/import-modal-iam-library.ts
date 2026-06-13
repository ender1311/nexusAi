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
  { pattern: /sowers/i,                                                              category: "giving",            subcategory: "sowers" },
  { pattern: /giving[\s-]tuesday/i,                                                  category: "giving",            subcategory: "giving-tuesday" },
  { pattern: /eoy[\s-]giving|end[\s-]of[\s-]year/i,                                 category: "giving",            subcategory: "year-end" },
  { pattern: /giving|donate|donation/i,                                              category: "giving",            subcategory: "appeal" },
  { pattern: /easter|palm[\s-]sunday|good[\s-]friday|pascoa|pasqua|resurrection|holy[\s-]week/i, category: "seasonal", subcategory: "easter" },
  { pattern: /lent[\s-]begins|lent$/i,                                               category: "seasonal",          subcategory: "lent-advent" },
  { pattern: /advent/i,                                                              category: "seasonal",          subcategory: "lent-advent" },
  { pattern: /christmas|christmas[\s-]story|christmas[\s-]eve/i,                    category: "seasonal",          subcategory: "christmas" },
  { pattern: /guided[\s-]scripture|daily[\s-]refresh|parables|transformation|beatitudes|peace|million.*bible/i, category: "guided-scripture", subcategory: "guided-scripture" },
  { pattern: /prayer|week[\s-]of[\s-]prayer/i,                                      category: "prayer",            subcategory: "prayer" },
  { pattern: /bioy|bible[\s-]in[\s-]one[\s-]year|challenge|mid[\s-]year[\s-]challenge/i, category: "bible-plans", subcategory: "challenge" },
  { pattern: /featured[\s-]plans|plan[\s-]cards/i,                                  category: "bible-plans",       subcategory: "featured-plans" },
  { pattern: /survey/i,                                                              category: "community",         subcategory: "survey" },
  { pattern: /share|gather|story|church|bafk|billion/i,                             category: "community",         subcategory: "sharing" },
  { pattern: /study[\s-]notes|bible[\s-]loop|nrsv|qr[\s-]code|tappable|cross[\s-]reference|mode[\s-][0-9]/i, category: "feature-education", subcategory: "new-feature" },
];

function deriveCategory(campaignName: string): { category: string; subcategory: string } {
  for (const { pattern, category, subcategory } of CATEGORY_MAP) {
    if (pattern.test(campaignName)) return { category, subcategory };
  }
  return { category: "editorial", subcategory: "general" };
}

// Lowercase variants only — realpath dedup handles case-insensitive filesystems (macOS).
const IAM_SUBFOLDERS = ["in-app message", "in-app message copy", "in-app event", "iam", "iam1", "iam2"];

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
 * Handles both underscore-separated (pt_BR) and dash-separated (pt-BR) locales.
 * Returns "en" for files with no language suffix.
 */
function detectLang(filename: string): string | null {
  // Match -lang.json or -lang_REGION.json or -lang-REGION.json at end
  const m = filename.match(/-([a-z]{2}(?:[_-][A-Za-z]{2})?)\.json$/i);
  if (m) {
    // Normalize to underscore separator and uppercase region: pt-BR → pt_BR
    return m[1].replace(/-([A-Za-z]{2})$/, (_: string, r: string) => `_${r.toUpperCase()}`);
  }
  // No lang suffix — treat as English
  if (filename.endsWith(".json")) return "en";
  return null;
}

/** Extract braze-images.com URL from an IAM HTML template file (not liquid_link.html). */
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

/**
 * Extract English deeplink from liquid_link.html.
 * Checks the IAM subfolder first, then the parent campaign directory.
 */
function extractDeeplink(iamDir: string): string | null {
  // Check IAM subfolder first, then campaign root
  const candidates = [
    path.join(iamDir, "liquid_link.html"),
    path.join(iamDir, "..", "liquid_link.html"),
  ];
  for (const linkFile of candidates) {
    if (!fs.existsSync(linkFile)) continue;
    try {
      const html = fs.readFileSync(linkFile, "utf8");
      // Try Liquid conditional en block — handles both single and double quotes
      const enMatch = html.match(/contains\s+['"]en['"]\s*[^%]*%\}[\s\n]*(https?:\/\/[^\s\n{%]+)/);
      if (enMatch) return enMatch[1].trim();
      // Plain URL (no Liquid)
      const urlMatch = html.match(/https?:\/\/[^\s<>"]+/);
      if (urlMatch) return urlMatch[0].trim();
    } catch {
      // ignore read errors
    }
  }
  return null;
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

  // Find image URL from HTML template files — exclude liquid_link.html
  const htmlFiles = fs
    .readdirSync(iamDir)
    .filter((f) => f.endsWith(".html") && !f.startsWith(".") && f !== "liquid_link.html");
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
      // No English file — log a warning and skip rather than silently mislabeling
      const langs = Array.from(byLang.keys()).join(", ");
      console.warn(`  [skip-no-en] variant key=${key} has no English file (available: ${langs})`);
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

async function importYear(year: string, dryRun: boolean, updateMode: boolean): Promise<void> {
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

    // Collect all modal IAM entries, deduplicating subfolders that resolve to the
    // same real path (avoids double-processing on case-insensitive macOS filesystems).
    const seenRealPaths = new Set<string>();
    const seenVariantNames = new Set<string>();
    const allEntries: ModalEntry[] = [];

    for (const sub of IAM_SUBFOLDERS) {
      const iamDir = path.join(campaignPath, sub);
      if (!fs.existsSync(iamDir)) continue;

      // Dedup by real path (handles iam/ === IAM/ on macOS)
      let realDir: string;
      try { realDir = fs.realpathSync(iamDir); } catch { continue; }
      if (seenRealPaths.has(realDir)) continue;
      seenRealPaths.add(realDir);

      const entries = readIamDir(iamDir);
      for (const entry of entries) {
        const name = `${campaign}${entry.variantSuffix}`;
        if (seenVariantNames.has(name)) {
          console.warn(`  [dup-subfolder] "${name}" found in multiple subfolders — using first occurrence`);
          continue;
        }
        seenVariantNames.add(name);
        allEntries.push(entry);
      }
    }

    if (allEntries.length === 0) {
      noIam++;
      continue;
    }

    const { category, subcategory } = deriveCategory(campaign);

    for (const entry of allEntries) {
      const variantName = `${campaign}${entry.variantSuffix}`;

      const existing = await prisma.messageVariant.findFirst({
        where: { name: variantName, message: { agentId: null, channel: "modal-iam" } },
        select: { id: true, cta: true },
      });
      if (existing) {
        if (updateMode && entry.cta && !existing.cta) {
          if (!dryRun) {
            await prisma.messageVariant.update({
              where: { id: existing.id },
              data: { cta: entry.cta, deeplink: entry.deeplink, iconImageUrl: entry.imageUrl },
            });
            console.log(`  [update] ${variantName} cta="${entry.cta}"`);
          } else {
            console.log(`  [update-dry] ${variantName} would set cta="${entry.cta}"`);
          }
          created++;
        } else {
          console.log(`  [exists] ${variantName}`);
          skipped++;
        }
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

      const translationData = Array.from(entry.translations.entries()).map(([lang, t]) => ({
        language: lang,
        title: t.title,
        body: t.body,
        status: "active",
        source: "import:dropbox",
        sourceFile: `${year}/${campaign}`,
      }));

      // Create variant + translations atomically so we never have a variant with missing translations
      const variant = await prisma.$transaction(async (tx) => {
        const v = await tx.messageVariant.create({
          data: {
            messageId: message.id,
            name: variantName,
            title: entry.title,
            body: entry.body,
            cta: entry.cta,
            deeplink: entry.deeplink,
            iconImageUrl: entry.imageUrl,
            category,
            subcategory,
            status: "active",
          },
        });
        if (translationData.length > 0) {
          await tx.messageVariantTranslation.createMany({
            data: translationData.map((t) => ({ ...t, messageVariantId: v.id })),
          });
        }
        return v;
      });

      created++;
      console.log(`           ✓ created variant ${variant.id} + ${translationData.length} translations`);
    }
  }

  console.log(`\n${year}: ${created} created/updated, ${skipped} skipped, ${noIam} no modal IAM`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const updateMode = args.includes("--update");
  const yearFlagIdx = args.indexOf("--year");
  const yearArg = args.find((a) => a.startsWith("--year="))?.split("=")[1]
    ?? (yearFlagIdx !== -1 ? args[yearFlagIdx + 1] : undefined);
  const years = yearArg ? [yearArg] : ["2025", "2026"];

  const modeLabel = dryRun ? "DRY RUN" : updateMode ? "UPDATE" : "LIVE";
  console.log(`Modal IAM library import — ${modeLabel}`);
  if (updateMode) console.log("  (--update: backfill cta/deeplink/image for existing variants missing cta)");
  console.log(`Base path: ${DROPBOX_BASE}\n`);

  for (const year of years) {
    console.log(`=== ${year} ===`);
    await importYear(year, dryRun, updateMode);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
