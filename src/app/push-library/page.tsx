export const revalidate = 0;

import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { usfmToHuman, usfmSortKey } from "@/lib/usfm";
import { VerseLibraryClient } from "@/components/push-library/verse-library-client";
import type { VerseRow, LangSummary, GapItem } from "@/types/campaign-content";

const CAMPAIGN = "resurrection-push";

type EnVerseRef = {
  usfmReference: string;
  usfmHuman: string;
  enATitle?: string;
  enBTitle?: string;
  enVerseText?: string;
};

export default async function PushLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ language?: string }>;
}) {
  const { language: langParam } = await searchParams;
  const activeLanguage = langParam ?? "en";
  const { user } = await getAuth();

  const allRows = await prisma.campaignContent.findMany({
    where: { campaign: CAMPAIGN, status: "active" },
    select: {
      id: true,
      contentType: true,
      language: true,
      usfmReference: true,
      usfmHuman: true,
      title: true,
      body: true,
    },
    orderBy: [{ language: "asc" }, { usfmReference: "asc" }],
  });

  // Compute language summaries using en as canonical
  const enRows = allRows.filter((r) => r.language === "en");
  const expectedCount = enRows.length; // 270 = 90 refs × 3 types

  const langCounts = new Map<string, number>();
  for (const r of allRows) {
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }

  const langSummaries: LangSummary[] = Array.from(langCounts.entries())
    .map(([language, total]) => ({
      language,
      total,
      expected: expectedCount,
      hasGaps: total < expectedCount,
    }))
    .sort((a, b) => {
      if (a.language === "en") return -1;
      if (b.language === "en") return 1;
      return a.language.localeCompare(b.language);
    });

  // Build en reference map: usfmRef:contentType → row
  const enRefMap = new Map(enRows.map((r) => [`${r.usfmReference}:${r.contentType}`, r]));

  // All USFM refs present in en (canonical set)
  const allRefs = Array.from(new Set(enRows.map((r) => r.usfmReference)));

  // Build verse rows for the active language
  const langRows = allRows.filter((r) => r.language === activeLanguage);
  const langByKey = new Map(langRows.map((r) => [`${r.usfmReference}:${r.contentType}`, r]));

  const verseRows: VerseRow[] = allRefs
    .map((usfmReference) => {
      const human = usfmToHuman(usfmReference);

      const aTitleRow = langByKey.get(`${usfmReference}:a-title`);
      const bTitleRow = langByKey.get(`${usfmReference}:b-title`);
      const verseTextRow = langByKey.get(`${usfmReference}:verse-text`);

      return {
        usfmReference,
        usfmHuman: human,
        sortKey: usfmSortKey(usfmReference),
        aTitle: aTitleRow ? { id: aTitleRow.id, text: aTitleRow.title ?? "" } : null,
        bTitle: bTitleRow ? { id: bTitleRow.id, text: bTitleRow.title ?? "" } : null,
        verseText: verseTextRow ? { id: verseTextRow.id, text: verseTextRow.body ?? "" } : null,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey);

  // Compute gaps for active language
  const gaps: GapItem[] = [];
  for (const row of verseRows) {
    if (!row.aTitle) {
      const en = enRefMap.get(`${row.usfmReference}:a-title`);
      gaps.push({ usfmReference: row.usfmReference, usfmHuman: row.usfmHuman, contentType: "a-title", englishText: en?.title ?? null });
    }
    if (!row.bTitle) {
      const en = enRefMap.get(`${row.usfmReference}:b-title`);
      gaps.push({ usfmReference: row.usfmReference, usfmHuman: row.usfmHuman, contentType: "b-title", englishText: en?.title ?? null });
    }
    if (!row.verseText) {
      const en = enRefMap.get(`${row.usfmReference}:verse-text`);
      gaps.push({ usfmReference: row.usfmReference, usfmHuman: row.usfmHuman, contentType: "verse-text", englishText: en?.body ?? null });
    }
  }

  // English reference data for edit modal (each ref → {aTitle, bTitle, verseText})
  const enByRef: Record<string, { aTitle?: string; bTitle?: string; verseText?: string }> = {};
  for (const r of enRows) {
    if (!enByRef[r.usfmReference]) enByRef[r.usfmReference] = {};
    const text = r.title ?? r.body ?? "";
    if (r.contentType === "a-title") enByRef[r.usfmReference].aTitle = text;
    else if (r.contentType === "b-title") enByRef[r.usfmReference].bTitle = text;
    else if (r.contentType === "verse-text") enByRef[r.usfmReference].verseText = text;
  }

  // All unique en refs for add-language drawer (sorted in canonical order)
  const enVerseRefs: EnVerseRef[] = allRefs
    .map((usfmReference) => ({
      usfmReference,
      usfmHuman: usfmToHuman(usfmReference),
      enATitle: enByRef[usfmReference]?.aTitle,
      enBTitle: enByRef[usfmReference]?.bTitle,
      enVerseText: enByRef[usfmReference]?.verseText,
    }))
    .sort((a, b) => usfmSortKey(a.usfmReference) - usfmSortKey(b.usfmReference));

  return (
    <VerseLibraryClient
      campaign={CAMPAIGN}
      activeLanguage={activeLanguage}
      langSummaries={langSummaries}
      verseRows={verseRows}
      gaps={gaps}
      enByRef={enByRef}
      enVerseRefs={enVerseRefs}
      isAuthenticated={!!user}
    />
  );
}
