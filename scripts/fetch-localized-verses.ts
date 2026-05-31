// Backfill localized verse text into CampaignContent (contentType "verse-text")
// by fetching each campaign USFM reference from the YouVersion Bible API in every
// language's default Bible version (see src/lib/youversion/verse-api.ts).
//
// SAFETY: dry-run by default — prints per-language counts and writes NOTHING.
// Pass --commit to upsert. Idempotent (unique key); never deletes. Existing
// verse-text rows are skipped unless --force. prisma here targets the .env.local
// DB (production) per CLAUDE.md, so review the dry-run before --commit.
//
// Flags:
//   --commit            apply upserts (default: dry run)
//   --force             refetch/overwrite languages that already have a row
//   --include-en        also (re)fetch English (default: skip; EN is seeded)
//   --campaign=<name>   campaign key (default: resurrection-push)
//   --lang=a,b,c        restrict to these language codes (default: all in map)
//   --limit=<n>         cap distinct USFM references (for testing)
import { prisma } from "@/lib/db";
import { usfmToHuman } from "@/lib/usfm";
import { LANGUAGE_VERSION_MAP, fetchVerse } from "@/lib/youversion/verse-api";

const CONCURRENCY = 10;

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

async function runBatched<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function main() {
  const doCommit = process.argv.includes("--commit");
  const force = process.argv.includes("--force");
  const includeEn = process.argv.includes("--include-en");
  const campaign = argValue("--campaign") ?? "resurrection-push";
  const langFilter = argValue("--lang")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = argValue("--limit") ? parseInt(argValue("--limit")!, 10) : undefined;

  // Languages to fill: the whole map minus "en" (unless --include-en), optionally
  // narrowed by --lang.
  const languages = Object.keys(LANGUAGE_VERSION_MAP)
    .filter((l) => includeEn || l !== "en")
    .filter((l) => !langFilter || langFilter.includes(l));

  // Distinct USFM references in the campaign, with a human label where one exists.
  const refRows = await prisma.campaignContent.findMany({
    where: { campaign },
    select: { usfmReference: true, usfmHuman: true },
    distinct: ["usfmReference"],
    orderBy: { usfmReference: "asc" },
  });
  let refs = refRows.map((r) => ({
    usfmReference: r.usfmReference,
    usfmHuman: r.usfmHuman ?? usfmToHuman(r.usfmReference),
  }));
  if (limit !== undefined) refs = refs.slice(0, limit);

  // Existing verse-text / reference rows → (contentType language usfm) keys to skip unless --force.
  const existing = await prisma.campaignContent.findMany({
    where: { campaign, contentType: { in: ["verse-text", "reference"] } },
    select: { contentType: true, language: true, usfmReference: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.contentType} ${e.language} ${e.usfmReference}`));
  const has = (ct: string, l: string, u: string) => existingKeys.has(`${ct} ${l} ${u}`);

  console.log(`Campaign: ${campaign}`);
  console.log(`References: ${refs.length} distinct USFM · Languages: ${languages.length}\n`);
  if (refs.length === 0 || languages.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  type Upsert = { contentType: "verse-text" | "reference"; language: string; usfmReference: string; usfmHuman: string; body: string };
  const toWrite: Upsert[] = [];
  const perLang: Record<string, { fetched: number; skippedExisting: number; missing: number }> = {};

  for (const language of languages) {
    const versionId = LANGUAGE_VERSION_MAP[language];
    const stats = { fetched: 0, skippedExisting: 0, missing: 0 };
    perLang[language] = stats;

    await runBatched(refs, CONCURRENCY, async (ref) => {
      if (!force && has("verse-text", language, ref.usfmReference) && has("reference", language, ref.usfmReference)) {
        stats.skippedExisting++;
        return;
      }
      const { text, reference } = await fetchVerse(ref.usfmReference, versionId);
      if (!text && !reference) {
        stats.missing++;
        return;
      }
      stats.fetched++;
      if (text && (force || !has("verse-text", language, ref.usfmReference))) {
        toWrite.push({ contentType: "verse-text", language, usfmReference: ref.usfmReference, usfmHuman: ref.usfmHuman, body: text });
      }
      if (reference && (force || !has("reference", language, ref.usfmReference))) {
        toWrite.push({ contentType: "reference", language, usfmReference: ref.usfmReference, usfmHuman: ref.usfmHuman, body: reference });
      }
    });

    console.log(
      `  ${language.padEnd(6)} v${String(versionId).padEnd(5)} ` +
      `fetched ${stats.fetched}, skipped(existing) ${stats.skippedExisting}, missing ${stats.missing}`,
    );
  }

  console.log(`\nTotal rows to write (verse-text + reference): ${toWrite.length}`);

  if (!doCommit) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
    return;
  }

  let created = 0, updated = 0;
  await runBatched(toWrite, CONCURRENCY, async (w) => {
    const where = {
      campaign_contentType_language_usfmReference: {
        campaign,
        contentType: w.contentType,
        language: w.language,
        usfmReference: w.usfmReference,
      },
    };
    const existed = await prisma.campaignContent.findUnique({ where, select: { id: true } });
    await prisma.campaignContent.upsert({
      where,
      create: {
        campaign,
        contentType: w.contentType,
        language: w.language,
        usfmReference: w.usfmReference,
        usfmHuman: w.usfmHuman,
        body: w.body,
        status: "active",
      },
      update: { body: w.body, status: "active" },
    });
    if (existed) updated++; else created++;
  });

  console.log(`\nCommitted: ${created} created, ${updated} updated.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
