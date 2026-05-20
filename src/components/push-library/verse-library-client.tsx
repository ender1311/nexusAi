"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VerseRow, LangSummary, GapItem } from "@/types/campaign-content";
import { EditContentModal } from "./edit-content-modal";
import { AddLanguageDrawer } from "./add-language-drawer";

type EnVerseRef = {
  usfmReference: string;
  usfmHuman: string;
  enATitle?: string;
  enBTitle?: string;
  enVerseText?: string;
};

type Props = {
  campaign: string;
  activeLanguage: string;
  langSummaries: LangSummary[];
  verseRows: VerseRow[];
  gaps: GapItem[];
  enByRef: Record<string, { aTitle?: string; bTitle?: string; verseText?: string }>;
  enVerseRefs: EnVerseRef[];
  isAuthenticated: boolean;
};

type EditTarget = {
  usfmReference: string;
  usfmHuman: string;
  prefillContentType?: "a-title" | "b-title" | "verse-text";
  aTitleId?: string;
  bTitleId?: string;
  verseTextId?: string;
  existingATitle?: string;
  existingBTitle?: string;
  existingVerseText?: string;
};

export function VerseLibraryClient({
  campaign,
  activeLanguage,
  langSummaries,
  verseRows,
  gaps,
  enByRef,
  enVerseRefs,
  isAuthenticated,
}: Props) {
  const router = useRouter();
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openEdit(row: VerseRow, prefillContentType?: "a-title" | "b-title" | "verse-text") {
    setEditTarget({
      usfmReference: row.usfmReference,
      usfmHuman: row.usfmHuman,
      prefillContentType,
      aTitleId: row.aTitle?.id,
      bTitleId: row.bTitle?.id,
      verseTextId: row.verseText?.id,
      existingATitle: row.aTitle?.text,
      existingBTitle: row.bTitle?.text,
      existingVerseText: row.verseText?.text,
    });
  }

  function openGap(gap: GapItem) {
    const row = verseRows.find((r) => r.usfmReference === gap.usfmReference);
    if (row) openEdit(row, gap.contentType);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Verse Push Library</h1>
        <span className="text-sm text-muted-foreground capitalize">
          {campaign.replace(/-/g, " ")}
        </span>
      </div>

      {/* Language tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {langSummaries.map((ls) => (
          <button
            key={ls.language}
            onClick={() => router.push(`/push-library?language=${ls.language}`)}
            className={[
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              ls.language === activeLanguage
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80",
            ].join(" ")}
          >
            {ls.language}{" "}
            <span className={ls.hasGaps ? "text-amber-500" : "text-green-600"}>
              {ls.hasGaps ? `⚠ ${Math.floor(ls.total / 3)}` : `✓ ${Math.floor(ls.total / 3)}`}
            </span>
          </button>
        ))}
        {isAuthenticated && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
          >
            + Add Language
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted/50">
            <tr className="border-b text-left">
              <th className="py-2 px-3 font-medium text-muted-foreground w-36">USFM Ref</th>
              <th className="py-2 px-3 font-medium text-muted-foreground">A-Title</th>
              <th className="py-2 px-3 font-medium text-muted-foreground">B-Title</th>
              <th className="py-2 px-3 font-medium text-muted-foreground">Verse Text</th>
              {isAuthenticated && (
                <th className="py-2 px-3 font-medium text-muted-foreground w-16">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {verseRows.map((row) => (
              <tr key={row.usfmReference} className="border-b hover:bg-muted/20">
                <td className="py-2 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {row.usfmHuman}
                </td>
                <td className="py-2 px-3 max-w-xs">
                  {row.aTitle ? (
                    <span className="line-clamp-1">{row.aTitle.text}</span>
                  ) : (
                    <span className="text-amber-500 text-xs">missing</span>
                  )}
                </td>
                <td className="py-2 px-3 max-w-xs">
                  {row.bTitle ? (
                    <span className="line-clamp-1">{row.bTitle.text}</span>
                  ) : (
                    <span className="text-amber-500 text-xs">missing</span>
                  )}
                </td>
                <td className="py-2 px-3 max-w-xs">
                  {row.verseText ? (
                    <span className="line-clamp-1">{row.verseText.text}</span>
                  ) : (
                    <span className="text-amber-500 text-xs">missing</span>
                  )}
                </td>
                {isAuthenticated && (
                  <td className="py-2 px-3">
                    <button
                      onClick={() => openEdit(row)}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {verseRows.length === 0 && (
              <tr>
                <td
                  colSpan={isAuthenticated ? 5 : 4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No content for language &quot;{activeLanguage}&quot; yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Gap panel */}
      {gaps.length > 0 && (
        <details open className="border rounded-lg p-4">
          <summary className="font-medium text-sm cursor-pointer select-none">
            ⚠ {gaps.length} missing entr{gaps.length === 1 ? "y" : "ies"} for &quot;{activeLanguage}&quot;
          </summary>
          <div className="mt-3 space-y-1">
            {gaps.map((gap, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">
                    {gap.usfmHuman}
                  </span>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
                    {gap.contentType}
                  </span>
                  {gap.englishText && (
                    <span className="text-xs text-muted-foreground truncate">
                      {gap.englishText}
                    </span>
                  )}
                </div>
                {isAuthenticated && (
                  <button
                    onClick={() => openGap(gap)}
                    className="text-xs text-primary hover:underline ml-2 shrink-0"
                  >
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Edit modal */}
      {editTarget && (
        <EditContentModal
          campaign={campaign}
          language={activeLanguage}
          usfmReference={editTarget.usfmReference}
          usfmHuman={editTarget.usfmHuman}
          prefillContentType={editTarget.prefillContentType}
          aTitleId={editTarget.aTitleId}
          bTitleId={editTarget.bTitleId}
          verseTextId={editTarget.verseTextId}
          existingATitle={editTarget.existingATitle}
          existingBTitle={editTarget.existingBTitle}
          existingVerseText={editTarget.existingVerseText}
          enRef={enByRef[editTarget.usfmReference] ?? {}}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            router.refresh();
          }}
        />
      )}

      {/* Add language drawer */}
      {drawerOpen && (
        <AddLanguageDrawer
          campaign={campaign}
          language={activeLanguage}
          enVerseRefs={enVerseRefs}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
