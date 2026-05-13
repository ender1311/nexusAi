import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { prisma } from "@/lib/db";
import { usfmToHuman } from "@/lib/usfm";

const CAMPAIGN = "resurrection-push";

function findDropboxBase(): string {
  const cloudBase = path.join(process.env.HOME!, "Library", "CloudStorage");
  if (!fs.existsSync(cloudBase)) {
    throw new Error(`CloudStorage directory not found at ${cloudBase}. Is Dropbox installed?`);
  }

  const dropboxFolder = fs.readdirSync(cloudBase).find((d) =>
    d.toLowerCase().startsWith("dropbox")
  );
  if (!dropboxFolder) {
    throw new Error(`No Dropbox folder found under ${cloudBase}`);
  }

  const accountBase = path.join(cloudBase, dropboxFolder);
  const accountEntries = fs.readdirSync(accountBase);
  if (accountEntries.length === 0) {
    throw new Error(`No entries found under ${accountBase}`);
  }

  // The account folder has a Unicode apostrophe (U+2019) in the name — enumerate rather than hardcode
  return path.join(accountBase, accountEntries[0]);
}

const SOURCES: Array<{ dir: string; contentType: "a-title" | "b-title" | "verse-text" }> = [
  { dir: "sourceA", contentType: "a-title" },
  { dir: "sourceB", contentType: "verse-text" },
  { dir: "sourceC", contentType: "b-title" },
];

async function importSource(
  pushBase: string,
  sourceDir: string,
  contentType: "a-title" | "b-title" | "verse-text"
): Promise<Record<string, number>> {
  const dirPath = path.join(pushBase, sourceDir);
  if (!fs.existsSync(dirPath)) {
    console.warn(`  Warning: ${dirPath} not found — skipping ${contentType}`);
    return {};
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const langCounts: Record<string, number> = {};
  let totalImported = 0;

  for (const file of files) {
    // Language code is the last dash-separated token before .yml
    // e.g. "2026-Q1-resurrection-Atitle-de.yml" → "de"
    // e.g. "2026-Q1-resurrection-Atitle-zh_CN.yml" → "zh_CN"
    const langMatch = file.match(/-([a-zA-Z_\-]+)\.ya?ml$/);
    if (!langMatch) {
      console.warn(`  Skipping unrecognized filename: ${file}`);
      continue;
    }
    const language = langMatch[1];

    const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
    const parsed = yaml.load(raw) as Record<string, string> | null;
    if (!parsed || typeof parsed !== "object") {
      console.warn(`  Skipping empty/invalid YAML: ${file}`);
      continue;
    }

    const rows = Object.entries(parsed).map(([usfmReference, text]) => ({
      campaign: CAMPAIGN,
      contentType,
      language,
      usfmReference,
      usfmHuman: usfmToHuman(usfmReference),
      title: contentType !== "verse-text" ? String(text) : null,
      body: contentType === "verse-text" ? String(text) : null,
    }));

    const result = await prisma.campaignContent.createMany({ data: rows, skipDuplicates: true });
    langCounts[language] = (langCounts[language] ?? 0) + result.count;
    totalImported += result.count;
  }

  console.log(
    `  ${contentType}: imported ${totalImported} new rows across ${Object.keys(langCounts).length} languages`
  );
  return langCounts;
}

async function main() {
  console.log("Seeding 2026 Resurrection Push content...\n");

  let dropboxBase: string;
  try {
    dropboxBase = findDropboxBase();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const pushBase = path.join(dropboxBase, "2026 Resurrection Push", "push", "Syntax Fixed");
  if (!fs.existsSync(pushBase)) {
    console.error(`Source not found: ${pushBase}`);
    console.error("Check that the Dropbox folder is synced and the path is correct.");
    process.exit(1);
  }
  console.log(`Source: ${pushBase}\n`);

  const allLangCounts: Record<string, number> = {};
  for (const { dir, contentType } of SOURCES) {
    const counts = await importSource(pushBase, dir, contentType);
    for (const [lang, count] of Object.entries(counts)) {
      allLangCounts[lang] = (allLangCounts[lang] ?? 0) + count;
    }
  }

  // Expected = max count per language (the language with the most rows is "complete")
  const maxCount = Math.max(0, ...Object.values(allLangCounts));
  console.log("\nGap summary (per language):");
  const sorted = Object.entries(allLangCounts).sort(([a], [b]) => a.localeCompare(b));
  for (const [lang, count] of sorted) {
    const gap = maxCount - count;
    const icon = gap > 0 ? "⚠" : "✓";
    const gapStr = gap > 0 ? ` (${gap} missing)` : "";
    console.log(`  ${icon} ${lang.padEnd(6)} ${count} rows${gapStr}`);
  }
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect())
  .catch(() => {
    // disconnect errors are non-fatal
  });
