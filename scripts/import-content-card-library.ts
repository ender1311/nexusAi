/**
 * Import content card variants from Dropbox campaign folders.
 *
 * Usage:
 *   bun run scripts/import-content-card-library.ts [--dry-run] [--year 2025]
 *
 * Reads CC JSON files from:
 *   <DROPBOX_CAMPAIGNS>/YEAR/CAMPAIGN/content card/CAMPAIGN-CC-en.json
 *
 * CC JSON format: { title, message, cta, [title_personal] }
 *
 * For each campaign it creates (or skips if already exists by name):
 * - One Message record per category (agentId: null, channel: "content-card")
 * - One MessageVariant per campaign/variation (English only — CC library has no translation layer)
 *
 * Category is derived from the campaign folder name (see CATEGORY_MAP below).
 */

import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/db";
import { CONTENT_CARD_CATEGORY_VALUES, CONTENT_CARD_SUBCATEGORIES } from "../src/lib/content-card-categories";

const DROPBOX_BASE = path.join(
  process.env.HOME ?? "",
  "Library/CloudStorage/Dropbox-Life.Church/Ion/Interactive/Design/Clint",
  "Clint McManaman’s files/Shared/YouVersionTeam/Communications/Campaigns",
);

const CATEGORY_MAP: Array<{ pattern: RegExp; category: string; subcategory: string }> = [
  { pattern: /sowers/i,                                          category: "giving",           subcategory: "impact-story" },
  { pattern: /giving.tuesday/i,                                  category: "giving",           subcategory: "giving-tuesday" },
  { pattern: /giving|donate|donation/i,                          category: "giving",           subcategory: "appeal" },
  { pattern: /easter|palm.sunday|good.friday|pascoa|pasqua|pspcoa|resurrection/i, category: "seasonal", subcategory: "easter" },
  { pattern: /christmas/i,                                       category: "seasonal",         subcategory: "christmas" },
  { pattern: /advent|lent/i,                                     category: "seasonal",         subcategory: "lent-advent" },
  { pattern: /guided.scripture/i,                                category: "guided-scripture", subcategory: "guided-scripture" },
  { pattern: /prayer/i,                                          category: "prayer",           subcategory: "prayer" },
  { pattern: /challenge/i,                                       category: "bible-plans",      subcategory: "challenge" },
  { pattern: /plans|bioy|featured/i,                             category: "bible-plans",      subcategory: "featured-plans" },
  { pattern: /bafk|bible.app.for.kids/i,                         category: "community",        subcategory: "community" },
  { pattern: /church|community|share|sharing/i,                  category: "community",        subcategory: "community" },
  { pattern: /survey/i,                                          category: "community",        subcategory: "community" },
  { pattern: /billion|account|workflow|study.notes|word|feature|education/i, category: "editorial", subcategory: "feature-highlight" },
];

function deriveCategory(campaignName: string): { category: string; subcategory: string } {
  for (const { pattern, category, subcategory } of CATEGORY_MAP) {
    if (pattern.test(campaignName)) return { category, subcategory };
  }
  return { category: "editorial", subcategory: "feature-highlight" };
}

interface CcJson {
  title?: string;
  message?: string;
  cta?: string;
  deeplink?: string;
}

function findCcDir(campaignPath: string): string | null {
  // Prefer lowercase "content card"; fall back to "Content Card"
  for (const sub of ["content card", "Content Card"]) {
    const p = path.join(campaignPath, sub);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

/** Read the English CC JSON from a content card folder.
 *  Also handles sub-folders like cc1/, cc2/ containing separate CC variants. */
function readCcEntries(ccDir: string, campaignName: string): Array<{ name: string; title: string; body: string; cta: string | null }> {
  const results: Array<{ name: string; title: string; body: string; cta: string | null }> = [];

  function processDir(dir: string, nameSuffix: string) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      if (!/-CC-en\.json$/i.test(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CcJson;
        const title = data.title?.trim();
        const body = data.message?.trim();
        if (!title || !body) continue;
        results.push({
          name: nameSuffix || campaignName,
          title,
          body,
          cta: data.cta?.trim() || null,
        });
      } catch {
        // skip malformed
      }
    }
    // Check one level of subfolders (cc1, cc2, en, int, etc.)
    for (const sub of fs.readdirSync(dir)) {
      const subPath = path.join(dir, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      if (sub.startsWith(".")) continue;
      for (const file of fs.readdirSync(subPath)) {
        if (!file.endsWith(".json")) continue;
        if (!/-CC-en\.json$/i.test(file)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(subPath, file), "utf8")) as CcJson;
          const title = data.title?.trim();
          const body = data.message?.trim();
          if (!title || !body) continue;
          const suffix = sub === "en" ? nameSuffix : `${nameSuffix} [${sub}]`;
          results.push({
            name: suffix || campaignName,
            title,
            body,
            cta: data.cta?.trim() || null,
          });
        } catch {
          // skip malformed
        }
      }
    }
  }

  processDir(ccDir, campaignName);
  return results;
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
  let noCC = 0;

  for (const campaign of campaigns) {
    const ccDir = findCcDir(path.join(yearDir, campaign));
    if (!ccDir) {
      noCC++;
      continue;
    }

    const entries = readCcEntries(ccDir, campaign);
    if (entries.length === 0) {
      console.warn(`  [skip] ${campaign}: no English CC entry`);
      skipped++;
      continue;
    }

    const { category, subcategory } = deriveCategory(campaign);

    // Validate category against the registered values
    if (!CONTENT_CARD_CATEGORY_VALUES.includes(category)) {
      console.warn(`  [skip] ${campaign}: invalid category "${category}"`);
      skipped++;
      continue;
    }
    if (subcategory && !CONTENT_CARD_SUBCATEGORIES[category]?.includes(subcategory)) {
      console.warn(`  [skip] ${campaign}: invalid subcategory "${subcategory}" for category "${category}"`);
      skipped++;
      continue;
    }

    for (const entry of entries) {
      const existing = await prisma.messageVariant.findFirst({
        where: { name: entry.name, message: { agentId: null, channel: "content-card" } },
      });
      if (existing) {
        console.log(`  [exists] ${entry.name}`);
        skipped++;
        continue;
      }

      console.log(`  [import] ${entry.name} → ${category}/${subcategory}`);
      console.log(`           title: ${entry.title.slice(0, 80)}`);
      console.log(`           body:  ${entry.body.slice(0, 80)}`);
      if (entry.cta) console.log(`           cta:   ${entry.cta}`);

      if (dryRun) {
        created++;
        continue;
      }

      let message = await prisma.message.findFirst({
        where: { agentId: null, channel: "content-card", variants: { some: { category } } },
      });
      if (!message) {
        message = await prisma.message.create({
          data: { agentId: null, name: `${category} Content Card Templates`, channel: "content-card" },
        });
      }

      await prisma.messageVariant.create({
        data: {
          messageId: message.id,
          name: entry.name,
          title: entry.title,
          body: entry.body,
          cta: entry.cta,
          category,
          subcategory,
          status: "active",
        },
      });

      created++;
      console.log(`           ✓ created`);
    }
  }

  console.log(`\n${year}: ${created} created, ${skipped} skipped, ${noCC} no CC folder`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yearIdx = args.indexOf("--year");
  const yearArg = args.find((a) => a.startsWith("--year="))?.split("=")[1]
    ?? (yearIdx >= 0 ? args[yearIdx + 1] : undefined);
  const years = yearArg ? [yearArg] : ["2025", "2026"];

  console.log(`Content Card library import — ${dryRun ? "DRY RUN" : "LIVE"}`);
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
