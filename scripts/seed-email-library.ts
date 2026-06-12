// Seed the email library from BRAZE-ready HTML files in the Dropbox campaigns corpus.
// Reads the curated campaign list below, extracts subject/CTA from <title> and href
// attributes, stores the full HTML in MessageVariant.htmlBody, and creates
// MessageVariantTranslation rows for each available language variant.
//
// SAFETY: dry-run by default — shows plan and writes NOTHING.
// Pass --commit to write to the DB (targets .env.local / production per CLAUDE.md).
// Idempotent: uses upsert on (messageVariantId, language) for translations.
// Never deletes existing records.

import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/db";

const isDryRun = !process.argv.includes("--commit");

// ---------------------------------------------------------------------------
// Curated campaign list. Each entry: [category, subcategory, folderFragment]
// folderFragment is matched case-insensitively against the folder name
// (after stripping the "YYYY-MM " date prefix).
// ---------------------------------------------------------------------------
const CAMPAIGNS: [string, string, string][] = [
  // Giving
  ["giving", "sowers",          "2026-05 Giving"],
  ["giving", "appeal",          "2025-05 Giving"],
  ["giving", "giving-tuesday",  "2025-11 Giving Tuesday Day Of"],
  ["giving", "year-end",        "2024-12 EOY Giving"],
  ["giving", "annual-statement","2023-01 2022 Giving Statement Email"],
  ["giving", "thank-you",       "2023-02 Giver Thanks"],
  // Bible Plans
  ["bible-plans", "featured-plans", "2025-10-06 Featured Plans"],
  ["bible-plans", "challenge",      "2025-02 21-Day Challenge Starts"],
  ["bible-plans", "challenge",      "2025-04 Easter Challenge Starts"],
  ["bible-plans", "seasonal-plans", "2024-04 Holy Spirit Plans"],
  // Guided Scripture
  ["guided-scripture", "guided-scripture", "2024-08 Guided Scripture - Doubt"],
  ["guided-scripture", "guided-scripture", "2025-06 Guided Scripture - Peace"],
  ["guided-scripture", "guided-scripture", "2025-08 Guided Scripture - Parables Series"],
  ["guided-scripture", "guided-scripture", "2024-10 Guided Scripture - Fruit of the Spirit"],
  ["guided-scripture", "guided-scripture", "2024-12 Guided Scripture - Christmas"],
  // Prayer
  ["prayer", "prayer",        "2023-12 Prayer for 2024"],
  ["prayer", "guided-prayer", "2024-04 Good Friday Prayer"],
  // Seasonal
  ["seasonal", "easter",      "2026-04 Post Easter"],
  ["seasonal", "easter",      "2025-04 Good Friday"],
  ["seasonal", "christmas",   "2025-12 Christmas Challenge Starts Now"],
  ["seasonal", "christmas",   "2024-12 Christmas Challenge Starts"],
  // Editorial
  ["editorial", "devotional", "2023-02 Editorial"],
  ["editorial", "devotional", "2023-03 Editorial"],
  // Community
  ["community", "community", "2025-06 Beyond a Billion Community Announcement"],
  ["community", "sharing",   "2026-05 Share Your Faith"],
];

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
function findCampaignsBase(): string {
  const cloudBase = path.join(process.env.HOME!, "Library", "CloudStorage");
  if (!fs.existsSync(cloudBase)) throw new Error(`CloudStorage not found: ${cloudBase}`);
  const dropboxFolder = fs.readdirSync(cloudBase).find((d) => d.toLowerCase().startsWith("dropbox"));
  if (!dropboxFolder) throw new Error("No Dropbox folder under CloudStorage");
  const ionClintPath = path.join(cloudBase, dropboxFolder, "Ion", "Interactive", "Design", "Clint");
  if (!fs.existsSync(ionClintPath)) throw new Error(`Clint folder not found: ${ionClintPath}`);
  const clintSub = fs.readdirSync(ionClintPath).find((d) => !d.startsWith("."));
  if (!clintSub) throw new Error(`No entries under ${ionClintPath}`);
  return path.join(ionClintPath, clintSub, "Shared", "YouVersionTeam", "Communications", "Campaigns");
}

function findBrazeHtmlFile(dir: string, lang: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (name === "Did NOT Do" || name.toLowerCase().includes("blog")) continue;
      const found = findBrazeHtmlFile(path.join(dir, name), lang);
      if (found) return found;
    } else if (
      name.startsWith("BRAZE-") &&
      name.endsWith(`-${lang}.html`) &&
      !name.toLowerCase().includes("blog")
    ) {
      return path.join(dir, name);
    }
  }
  return null;
}

function findAllLangVariants(dir: string): { lang: string; filePath: string }[] {
  const results: { lang: string; filePath: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "Did NOT Do" || entry.name.toLowerCase().includes("blog")) continue;
        walk(path.join(d, entry.name));
      } else {
        const m = entry.name.match(/^BRAZE-.*?-([a-z]{2}(?:_[A-Z]{2})?)\.html$/);
        if (m && !entry.name.toLowerCase().includes("blog")) {
          const lang = m[1];
          if (lang !== "en") results.push({ lang, filePath: path.join(d, entry.name) });
        }
      }
    }
  };
  walk(dir);
  // deduplicate: keep first occurrence per language
  const seen = new Set<string>();
  return results.filter(({ lang }) => {
    if (seen.has(lang)) return false;
    seen.add(lang);
    return true;
  });
}

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------
function extractSubject(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  // Strip HTML tags and decode basic entities
  return m[1]
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function extractPrimaryCta(html: string): string | null {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (!href.includes("bible.com") && !href.includes("youversion.com")) continue;
    if (["unsubscribe", "privacy", "help.", "/app?", "/app\"", "youtube", "blog", "footer"].some((s) => href.includes(s))) continue;
    // Strip UTM params for cleanliness
    const clean = href.split("&amp;utm_")[0].split("?utm_")[0].replace(/&amp;/g, "&");
    return clean;
  }
  return null;
}

function extractBodySnippet(html: string): string {
  // Extract first meaningful text block (H1 or first paragraph)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    return h1[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const base = findCampaignsBase();
  console.log(`Campaigns base: ${base}`);
  console.log(isDryRun ? "\nDRY RUN — pass --commit to write to DB\n" : "\n--commit mode — writing to DB\n");

  const years = ["2026", "2025", "2024", "2023"];

  type CampaignEntry = {
    category: string;
    subcategory: string;
    name: string;
    folderPath: string;
    enFilePath: string;
    enHtml: string;
    subject: string;
    cta: string | null;
    body: string;
    translations: { lang: string; filePath: string }[];
  };

  const plan: CampaignEntry[] = [];

  for (const [category, subcategory, folderPattern] of CAMPAIGNS) {
    // Try exact match first, then substring match, across all years
    let matched: string | null = null;

    for (const year of years) {
      const yearPath = path.join(base, year);
      if (!fs.existsSync(yearPath)) continue;
      const folders = fs.readdirSync(yearPath);

      // Exact match (case-insensitive) against full folder name
      let folder = folders.find((f) => f.toLowerCase() === folderPattern.toLowerCase());
      // Fallback: folder contains the pattern (after stripping year prefix)
      if (!folder) {
        const patternStripped = folderPattern.replace(/^\d{4}-\d{2}\s+/, "").toLowerCase();
        folder = folders.find((f) => {
          const stripped = f.replace(/^\d{4}-\d{2}\s+/, "").toLowerCase();
          return stripped === patternStripped;
        });
      }
      if (!folder) continue;

      const folderPath = path.join(yearPath, folder);
      const enFile = findBrazeHtmlFile(folderPath, "en");
      if (!enFile) continue;

      matched = folderPath;
      const enHtml = fs.readFileSync(enFile, "utf-8");
      const subject = extractSubject(enHtml);
      const cta = extractPrimaryCta(enHtml);
      const body = extractBodySnippet(enHtml);
      const translations = findAllLangVariants(folderPath).slice(0, 30);

      plan.push({ category, subcategory, name: folder.replace(/^\d{4}-\d{2}\s+/, ""), folderPath, enFilePath: enFile, enHtml, subject, cta, body, translations });
      break;
    }

    if (!matched) {
      console.warn(`  WARN: No BRAZE en.html found for: ${folderPattern}`);
    }
  }

  console.log(`\nPlan: ${plan.length} campaigns\n`);
  for (const e of plan) {
    const enSizeKb = Math.round(e.enHtml.length / 1024);
    console.log(`  [${e.category}/${e.subcategory}] ${e.name} — "${e.subject.slice(0, 50)}" — ${enSizeKb}KB — ${e.translations.length} langs`);
  }

  if (isDryRun) {
    console.log("\nDry run complete. Use --commit to write to DB.");
    return;
  }

  // --- Commit ---
  // Cache messages per category (agentId = null = library)
  const messageCache = new Map<string, string>();
  const getOrCreateMessage = async (cat: string): Promise<string> => {
    if (messageCache.has(cat)) return messageCache.get(cat)!;
    let msg = await prisma.message.findFirst({ where: { agentId: null, channel: "email", name: `${cat} Email Templates` } });
    if (!msg) {
      msg = await prisma.message.create({
        data: { agentId: null, name: `${cat} Email Templates`, channel: "email" },
      });
    }
    messageCache.set(cat, msg.id);
    return msg.id;
  };

  let created = 0, skipped = 0, translationUpserts = 0;

  for (const entry of plan) {
    const messageId = await getOrCreateMessage(entry.category);

    // Check if variant already exists by name + message
    const existing = await prisma.messageVariant.findFirst({
      where: { messageId, name: entry.name },
    });

    let variantId: string;
    if (existing) {
      // Update htmlBody/subject if different
      if (existing.htmlBody !== entry.enHtml || existing.subject !== entry.subject) {
        await prisma.messageVariant.update({
          where: { id: existing.id },
          data: { htmlBody: entry.enHtml, subject: entry.subject, cta: entry.cta, deeplink: entry.cta, body: entry.body || entry.subject },
        });
        console.log(`  Updated: ${entry.name}`);
      } else {
        console.log(`  Skipped (unchanged): ${entry.name}`);
        skipped++;
      }
      variantId = existing.id;
    } else {
      const variant = await prisma.messageVariant.create({
        data: {
          messageId,
          name: entry.name,
          subject: entry.subject,
          htmlBody: entry.enHtml,
          body: entry.body || entry.subject,
          cta: entry.cta,
          deeplink: entry.cta,
          category: entry.category,
          subcategory: entry.subcategory,
          status: "active",
        },
      });
      variantId = variant.id;
      created++;
      console.log(`  Created: ${entry.name} (${entry.translations.length} langs pending)`);
    }

    // Upsert translations
    for (const { lang, filePath } of entry.translations) {
      const langHtml = fs.readFileSync(filePath, "utf-8");
      const langSubject = extractSubject(langHtml);
      const langBody = extractBodySnippet(langHtml) || entry.body;

      await prisma.messageVariantTranslation.upsert({
        where: { messageVariantId_language: { messageVariantId: variantId, language: lang } },
        update: { htmlBody: langHtml, subject: langSubject || undefined, sourceFile: filePath },
        create: {
          messageVariantId: variantId,
          language: lang,
          subject: langSubject || null,
          htmlBody: langHtml,
          body: langBody || entry.subject,
          status: "active",
          source: "import:dropbox",
          sourceFile: filePath,
        },
      });
      translationUpserts++;
    }
  }

  console.log(`\nDone. Created: ${created}, skipped: ${skipped}, translation upserts: ${translationUpserts}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
