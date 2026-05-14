import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { prisma } from "@/lib/db";
import { usfmToHuman } from "@/lib/usfm";

const CAMPAIGN = "resurrection-push";

function findPushBase(): string {
  const cloudBase = path.join(process.env.HOME!, "Library", "CloudStorage");
  if (!fs.existsSync(cloudBase)) {
    throw new Error(`CloudStorage directory not found: ${cloudBase}. Is Dropbox installed?`);
  }

  const dropboxFolder = fs.readdirSync(cloudBase).find((d) =>
    d.toLowerCase().startsWith("dropbox")
  );
  if (!dropboxFolder) throw new Error(`No Dropbox folder found under ${cloudBase}`);

  const dropboxBase = path.join(cloudBase, dropboxFolder);

  // The files live deep under a shared folder whose name contains a Unicode apostrophe (U+2019).
  // Enumerate each apostrophe-containing segment rather than hardcoding the character.
  const ionClintPath = path.join(dropboxBase, "Ion", "Interactive", "Design", "Clint");
  if (!fs.existsSync(ionClintPath)) {
    throw new Error(`Expected shared folder not found: ${ionClintPath}`);
  }
  const clintSub = fs.readdirSync(ionClintPath).find((d) => !d.startsWith("."));
  if (!clintSub) throw new Error(`No entries under ${ionClintPath}`);

  return path.join(
    ionClintPath, clintSub,
    "Shared", "YouVersionTeam", "Communications", "Campaigns",
    "2026", "2026 Resurrection Push", "source", "Syntax Fixed"
  );
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
    // Strip extension, take the last '-'-separated segment as the language code
    // e.g. "2026-Q1-resurrection-Atitle-de.yml" → "de"
    // e.g. "2026-Q1-resurrection-Atitle-zh_CN.yml" → "zh_CN"
    const base = file.replace(/\.ya?ml$/, "");
    const language = base.split("-").at(-1)!;
    if (!language || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(language)) {
      console.warn(`  Skipping unrecognized filename: ${file}`);
      continue;
    }

    const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
    let parsed: Record<string, string> | null;
    try {
      parsed = yaml.load(raw) as Record<string, string> | null;
    } catch {
      // Some files have unescaped " inside double-quoted values (invalid YAML).
      // Fall back to a line-by-line regex parser for the known KEY: "value" format.
      parsed = {};
      let fallbackOk = true;
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
        // Match USFM key followed by a double-quoted value (value may itself contain quotes)
        const m = trimmed.match(/^([A-Z0-9.+]+):\s+"(.*)"$/);
        if (!m) { fallbackOk = false; break; }
        parsed[m[1]] = m[2];
      }
      if (!fallbackOk || Object.keys(parsed).length === 0) {
        console.warn(`  Skipping malformed YAML (unparseable): ${file}`);
        continue;
      }
      console.warn(`  Recovered malformed YAML via fallback parser: ${file}`);
    }
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

  let pushBase: string;
  try {
    pushBase = findPushBase();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

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
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
