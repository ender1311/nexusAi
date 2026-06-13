/**
 * Comprehensive email library import from Dropbox campaign folders.
 *
 * Usage:
 *   bun run scripts/import-email-library.ts [--dry-run] [--year=2025] [--all-years]
 *
 * Auto-discovers all campaign folders with an emails/ or email/ subfolder,
 * finds the English BRAZE-*.html file, extracts subject/body/CTA, and upserts
 * the MessageVariant + MessageVariantTranslation rows.
 *
 * Default: imports all years (2023–2026). Pass --year=YYYY to target one year.
 * Category is derived via pattern matching on the campaign folder name.
 */

import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/db";
import { EMAIL_CATEGORY_VALUES, EMAIL_SUBCATEGORIES } from "../src/lib/email-categories";

const DROPBOX_BASE = path.join(
  process.env.HOME ?? "",
  "Library/CloudStorage/Dropbox-Life.Church/Ion/Interactive/Design/Clint",
  "Clint McManaman’s files/Shared/YouVersionTeam/Communications/Campaigns",
);

// Noise / test folders — skip entirely
const SKIP_PATTERNS = [
  /agent.practice/i,
  /email.migration/i,
  /uxr.emails/i,
];

// Ordered most-specific first. First match wins.
const CATEGORY_MAP: Array<{ pattern: RegExp; category: string; subcategory: string }> = [
  // ---- Giving ----
  { pattern: /sowers/i,                                                         category: "giving",           subcategory: "sowers" },
  { pattern: /giving.tuesday/i,                                                 category: "giving",           subcategory: "giving-tuesday" },
  { pattern: /eoy\s*giving|end.of.year.*giving|year.end.*giving/i,             category: "giving",           subcategory: "year-end" },
  { pattern: /giving\s*statement|annual\s*statement|eoy.*impact\s*statement/i, category: "giving",           subcategory: "annual-statement" },
  { pattern: /giver.thank|recurring.giver|new.sowers.welcome|sowers.welcome|thank.you.*giv|giver.apology/i, category: "giving", subcategory: "thank-you" },
  { pattern: /lapsed.giver|first.time.giver|canceled.gift|donation.abandon|donor.lapsed|donation.decline|give.screen.re.engagement/i, category: "giving", subcategory: "appeal" },
  { pattern: /giving|donate|donation/i,                                         category: "giving",           subcategory: "appeal" },
  // ---- Bible Plans — challenge first so "Easter Challenge" beats seasonal easter ----
  { pattern: /\bchallenge\b/i,                                                  category: "bible-plans",      subcategory: "challenge" },
  // ---- Guided Scripture — before prayer so "GS - Christmas" stays guided-scripture ----
  { pattern: /guided.scripture/i,                                               category: "guided-scripture", subcategory: "guided-scripture" },
  { pattern: /armor.of.god|beatitudes|rest.focus|spoken.gospel|parables.series|bibleproject|bible.project|billions.*guided|billion.*guided.script/i, category: "guided-scripture", subcategory: "guided-scripture" },
  // ---- Prayer — before seasonal so "Good Friday Prayer" stays prayer ----
  { pattern: /guided.prayer/i,                                                  category: "prayer",           subcategory: "guided-prayer" },
  { pattern: /\bprayer\b|week.of.prayer/i,                                     category: "prayer",           subcategory: "prayer" },
  // ---- Seasonal ----
  { pattern: /easter|palm.sunday|holy.week|last.supper|good.friday|resurrection|post.easter|listen.to.the.easter/i, category: "seasonal", subcategory: "easter" },
  { pattern: /christmas/i,                                                      category: "seasonal",         subcategory: "christmas" },
  { pattern: /advent|lent|\bpentecost\b/i,                                     category: "seasonal",         subcategory: "lent-advent" },
  // ---- Bible Plans (rest) ----
  { pattern: /featured.plans|bioy|bible.in.one.year|new.testament.plans|whole.bible.plans/i, category: "bible-plans", subcategory: "featured-plans" },
  { pattern: /holy.spirit.plans|seasonal.plans/i,                              category: "bible-plans",      subcategory: "seasonal-plans" },
  // ---- Community ----
  { pattern: /bafk|bible.app.for.kids|kids.bible.experience/i,                 category: "community",        subcategory: "community" },
  { pattern: /share.your.faith|share.your.story|evangelism|onboarding.share/i, category: "community",       subcategory: "sharing" },
  { pattern: /billion|beyond.a.billion|gather.?25/i,                           category: "community",        subcategory: "community" },
  { pattern: /localization.volunteer|call.for.stories|global.bible.month|find.your.church|good.neighbor|community.announc/i, category: "community", subcategory: "community" },
  { pattern: /survey|brand.survey|spiritual.rhythms/i,                         category: "community",        subcategory: "community" },
  // ---- Editorial ----
  { pattern: /devotional/i,                                                     category: "editorial",        subcategory: "devotional" },
  { pattern: /feature.education|feature.fomo|feature.highlight|tappable|what.s.new|plans.features|mode.[14]|daily.refresh.takeover|plans.survey|bible.version.sharing/i, category: "editorial", subcategory: "feature-highlight" },
  { pattern: /chosen.seasons|bible.for.everyone|it.starts.with.the.bible|why.scripture|i.want.to.read|verse.of.the.year|year.in.review|bible.publishing|15.year/i, category: "editorial", subcategory: "devotional" },
];

function deriveCategory(campaignName: string): { category: string; subcategory: string } {
  for (const { pattern, category, subcategory } of CATEGORY_MAP) {
    if (pattern.test(campaignName)) return { category, subcategory };
  }
  return { category: "editorial", subcategory: "feature-highlight" };
}

function shouldSkip(name: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(name));
}

function findEmailDir(campaignPath: string): string | null {
  for (const sub of ["emails", "email", "Emails", "Email"]) {
    const p = path.join(campaignPath, sub);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
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
  const seen = new Set<string>();
  return results.filter(({ lang }) => {
    if (seen.has(lang)) return false;
    seen.add(lang);
    return true;
  });
}

function extractSubject(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
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
    if (
      ["unsubscribe", "privacy", "help.", "/app?", '/app"', "youtube", "blog", "footer"].some(
        (s) => href.includes(s),
      )
    )
      continue;
    const clean = href.split("&amp;utm_")[0].split("?utm_")[0].replace(/&amp;/g, "&");
    return clean;
  }
  return null;
}

function extractBodySnippet(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    return h1[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }
  return "";
}

async function importYear(
  year: string,
  dryRun: boolean,
): Promise<{ created: number; skipped: number; noEmail: number }> {
  const yearDir = path.join(DROPBOX_BASE, year);
  if (!fs.existsSync(yearDir)) {
    console.log(`  Year directory not found: ${yearDir}`);
    return { created: 0, skipped: 0, noEmail: 0 };
  }

  const campaigns = fs.readdirSync(yearDir).filter((d) => {
    const full = path.join(yearDir, d);
    return !d.startsWith(".") && fs.statSync(full).isDirectory();
  });

  // Message cache: category → id
  const messageCache = new Map<string, string>();
  const getOrCreateMessage = async (cat: string): Promise<string> => {
    if (messageCache.has(cat)) return messageCache.get(cat)!;
    let msg = await prisma.message.findFirst({
      where: { agentId: null, channel: "email", name: `${cat} Email Templates` },
    });
    if (!msg) {
      msg = await prisma.message.create({
        data: { agentId: null, name: `${cat} Email Templates`, channel: "email" },
      });
    }
    messageCache.set(cat, msg.id);
    return msg.id;
  };

  let created = 0;
  let skipped = 0;
  let noEmail = 0;

  for (const campaign of campaigns) {
    if (shouldSkip(campaign)) {
      console.log(`  [skip/noise] ${campaign}`);
      continue;
    }

    const emailDir = findEmailDir(path.join(yearDir, campaign));
    if (!emailDir) {
      noEmail++;
      continue;
    }

    // Check for existing variant (idempotency) — applies in both dry-run and live
    const existing = await prisma.messageVariant.findFirst({
      where: { name: campaign, message: { agentId: null, channel: "email" } },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const enFile = findBrazeHtmlFile(emailDir, "en");
    if (!enFile) {
      console.warn(`  [warn] ${campaign}: no BRAZE en.html found`);
      skipped++;
      continue;
    }

    const enHtml = fs.readFileSync(enFile, "utf-8");
    const subject = extractSubject(enHtml);
    const cta = extractPrimaryCta(enHtml);
    const body = extractBodySnippet(enHtml);
    const { category, subcategory } = deriveCategory(campaign);

    if (!EMAIL_CATEGORY_VALUES.includes(category)) {
      console.warn(`  [skip] ${campaign}: invalid category "${category}"`);
      skipped++;
      continue;
    }
    if (subcategory && !EMAIL_SUBCATEGORIES[category]?.includes(subcategory)) {
      console.warn(`  [skip] ${campaign}: invalid subcategory "${subcategory}" for "${category}"`);
      skipped++;
      continue;
    }

    const translations = findAllLangVariants(emailDir);

    console.log(`  [import] ${campaign} → ${category}/${subcategory}`);
    if (subject) console.log(`           subject: ${subject.slice(0, 70)}`);
    if (translations.length > 0) console.log(`           langs: ${translations.map((t) => t.lang).join(", ")}`);

    if (dryRun) {
      created++;
      continue;
    }

    const messageId = await getOrCreateMessage(category);

    const variant = await prisma.messageVariant.create({
      data: {
        messageId,
        name: campaign,
        subject: subject || null,
        htmlBody: enHtml,
        body: body || subject || campaign,
        cta: cta || null,
        deeplink: cta || null,
        category,
        subcategory,
        status: "active",
      },
    });

    let transCreated = 0;
    for (const { lang, filePath } of translations.slice(0, 30)) {
      const langHtml = fs.readFileSync(filePath, "utf-8");
      const langSubject = extractSubject(langHtml);
      const langBody = extractBodySnippet(langHtml) || body;

      await prisma.messageVariantTranslation.upsert({
        where: { messageVariantId_language: { messageVariantId: variant.id, language: lang } },
        update: { htmlBody: langHtml, subject: langSubject || undefined, sourceFile: filePath },
        create: {
          messageVariantId: variant.id,
          language: lang,
          subject: langSubject || null,
          htmlBody: langHtml,
          body: langBody || subject || campaign,
          status: "active",
          source: "import:dropbox",
          sourceFile: filePath,
        },
      });
      transCreated++;
    }

    created++;
    if (transCreated > 0) console.log(`           ✓ created + ${transCreated} translations`);
    else console.log(`           ✓ created`);
  }

  return { created, skipped, noEmail };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yearIdx = args.indexOf("--year");
  const yearArg =
    args.find((a) => a.startsWith("--year="))?.split("=")[1] ??
    (yearIdx >= 0 ? args[yearIdx + 1] : undefined);

  const years = yearArg ? [yearArg] : ["2023", "2024", "2025", "2026"];

  console.log(`Email library import — ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Base path: ${DROPBOX_BASE}`);
  console.log(`Years: ${years.join(", ")}\n`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalNoEmail = 0;

  for (const year of years) {
    console.log(`=== ${year} ===`);
    const { created, skipped, noEmail } = await importYear(year, dryRun);
    totalCreated += created;
    totalSkipped += skipped;
    totalNoEmail += noEmail;
    console.log(`  → ${created} created, ${skipped} skipped/exists, ${noEmail} no email folder\n`);
  }

  console.log(
    `Total: ${totalCreated} created, ${totalSkipped} skipped/exists, ${totalNoEmail} no email folder`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
