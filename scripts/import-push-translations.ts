// Backfill push translations from the Dropbox campaigns corpus into
// MessageVariantTranslation rows. Walks Campaigns/{2025,2026}/ recursively, matches
// each <stem>-<lang>.{json,yml,yaml} file to a push MessageVariant via
// actionFeatures.sourceFile, and upserts non-English copy.
//
// SAFETY: dry-run by default — prints the plan and writes NOTHING. Pass --commit to
// upsert; pass --refresh-english to also overwrite diverging English bodies.
// Idempotent (unique key); never deletes. prisma here targets the .env.local DB
// (production) per CLAUDE.md, so review the dry-run before passing --commit.
import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/db";
import {
  groupImportFiles, buildImportPlan, commitImportPlan,
  type ImportFile, type VariantSnapshot,
} from "@/lib/push-import";

const CAMPAIGN_YEARS = ["2025", "2026"];
const EXT = /\.(json|ya?ml)$/i;

function findCampaignsBase(): string {
  const cloudBase = path.join(process.env.HOME!, "Library", "CloudStorage");
  if (!fs.existsSync(cloudBase)) {
    throw new Error(`CloudStorage directory not found: ${cloudBase}. Is Dropbox installed?`);
  }
  const dropboxFolder = fs.readdirSync(cloudBase).find((d) => d.toLowerCase().startsWith("dropbox"));
  if (!dropboxFolder) throw new Error(`No Dropbox folder found under ${cloudBase}`);

  // Mirrors scripts/seed-resurrection-push.ts: the shared folder under Clint has a
  // single dynamic child (its name contains a Unicode apostrophe); enumerate it
  // rather than hardcoding the character.
  const ionClintPath = path.join(cloudBase, dropboxFolder, "Ion", "Interactive", "Design", "Clint");
  if (!fs.existsSync(ionClintPath)) throw new Error(`Expected shared folder not found: ${ionClintPath}`);
  const clintSub = fs.readdirSync(ionClintPath).find((d) => !d.startsWith("."));
  if (!clintSub) throw new Error(`No entries under ${ionClintPath}`);

  return path.join(ionClintPath, clintSub, "Shared", "YouVersionTeam", "Communications", "Campaigns");
}

function walkFiles(dir: string, relRoot: string, out: ImportFile[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, relRoot, out);
    } else if (EXT.test(entry.name)) {
      out.push({ relativePath: path.relative(relRoot, full), contents: fs.readFileSync(full, "utf-8") });
    }
  }
}

async function main() {
  const doCommit = process.argv.includes("--commit");
  const refreshEnglish = process.argv.includes("--refresh-english");

  let base: string;
  try {
    base = findCampaignsBase();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(`Campaigns corpus: ${base}\n`);

  const files: ImportFile[] = [];
  for (const year of CAMPAIGN_YEARS) {
    const yearDir = path.join(base, year);
    if (!fs.existsSync(yearDir)) { console.warn(`  (skip) ${year} not found under corpus`); continue; }
    walkFiles(yearDir, base, files);
  }
  console.log(`Collected ${files.length} candidate files.\n`);

  const { groups, skipped } = groupImportFiles(files);

  const variants = await prisma.messageVariant.findMany({
    where: { message: { channel: "push" } },
    select: { id: true, name: true, body: true, actionFeatures: true, translations: { select: { language: true } } },
  });
  const snapshots: VariantSnapshot[] = variants.map((v) => {
    const af = (v.actionFeatures as Record<string, unknown> | null) ?? null;
    const sourceFile = af && typeof af.sourceFile === "string" ? af.sourceFile : null;
    return { id: v.id, name: v.name, body: v.body, sourceFile, existingLanguages: new Set(v.translations.map((t) => t.language)) };
  });

  const plan = buildImportPlan(groups, snapshots);

  console.log(
    `Plan: ${plan.totals.matchedStems} matched · ${plan.totals.unmatchedStems} unmatched · ` +
    `${plan.totals.creates} new · ${plan.totals.updates} updates`
  );
  for (const m of plan.matched) {
    const langs = m.languages.map((l) => `${l.language}(${l.action})`).join(", ") || "—";
    const div = m.englishDivergence ? "  ⚠ EN diverges" : "";
    console.log(`  ✓ ${m.variantName} [${m.stem}]: ${langs}${div}`);
  }
  if (plan.unmatched.length > 0) {
    console.log(`\nUnmatched stems (no push variant with a matching sourceFile):`);
    for (const u of plan.unmatched) console.log(`  ✗ ${u.stem} — ${u.languages.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped files (${skipped.length}):`);
    for (const s of skipped.slice(0, 50)) console.log(`  - ${s.relativePath}: ${s.reason}`);
    if (skipped.length > 50) console.log(`  …and ${skipped.length - 50} more`);
  }

  if (!doCommit) {
    console.log(`\nDRY RUN — nothing written. Re-run with --commit to apply${refreshEnglish ? " (English refresh ON)" : ""}.`);
    return;
  }

  const committed = await commitImportPlan(plan, prisma, { source: "import:dropbox", refreshEnglish });
  console.log(`\nCommitted: ${committed.created} created, ${committed.updated} updated, ${committed.englishRefreshed} English refreshed.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
