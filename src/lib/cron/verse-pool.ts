// Load + shape the CampaignContent verse pool for the verse-push experiment.
import { usfmToHuman, usfmSortKey } from "@/lib/usfm";
import type { VersePool, VerseEntry, VerseField, VerseLangContent } from "@/lib/verse-content";

const CAMPAIGN = "resurrection-push";
// Render fields required for an entry to be poolable.
const CONTENT_TYPES = ["reference", "a-title", "b-title", "verse-text"] as const;
const IMAGE_CONTENT_TYPE = "image";
// Types fetched from the DB (image is loaded but not required for poolability).
const LOAD_CONTENT_TYPES = [...CONTENT_TYPES, IMAGE_CONTENT_TYPE] as const;

export type CampaignContentRow = {
  contentType: string;
  language: string;
  usfmReference: string;
  usfmHuman: string | null;
  title: string | null;
  body: string | null;
};

/** Pure: raw CampaignContent rows → ordered verse pool. EN must be able to
 *  render every arm (verse-text + a-title + b-title; reference is derivable). */
export function shapeVersePool(rows: CampaignContentRow[]): VersePool {
  const byUsfm = new Map<string, VerseEntry>();
  for (const r of rows) {
    let e = byUsfm.get(r.usfmReference);
    if (!e) { e = { usfm: r.usfmReference, byLang: new Map() }; byUsfm.set(r.usfmReference, e); }

    if (r.contentType === IMAGE_CONTENT_TYPE) {
      const id = r.body?.trim();
      if (id) e.imageId = id;
      continue;
    }

    const field = r.contentType as VerseField;
    if (!CONTENT_TYPES.includes(field as (typeof CONTENT_TYPES)[number])) continue;
    let lc = e.byLang.get(r.language) as VerseLangContent | undefined;
    if (!lc) { lc = {}; e.byLang.set(r.language, lc); }
    const value = field === "a-title" || field === "b-title" ? r.title : r.body;
    if (value && value.trim()) lc[field] = value;
  }
  for (const e of byUsfm.values()) {
    const en = (e.byLang.get("en") ?? {}) as VerseLangContent;
    if (!en.reference) en.reference = usfmToHuman(e.usfm);
    e.byLang.set("en", en);
  }
  // EN must render every arm. `reference` is omitted here because it was just
  // backfilled above (usfmToHuman), so every entry already has it.
  const pool = [...byUsfm.values()].filter((e) => {
    const en = e.byLang.get("en");
    return !!(en && en["verse-text"] && en["a-title"] && en["b-title"]);
  });
  pool.sort((a, b) => usfmSortKey(a.usfm) - usfmSortKey(b.usfm));
  return pool;
}

/** Load the active verse pool from the DB and shape it. */
export async function loadVersePool(prisma: typeof import("@/lib/db").prisma): Promise<VersePool> {
  const rows = await prisma.campaignContent.findMany({
    where: { campaign: CAMPAIGN, status: "active", contentType: { in: [...LOAD_CONTENT_TYPES] } },
    select: { contentType: true, language: true, usfmReference: true, usfmHuman: true, title: true, body: true },
  });
  return shapeVersePool(rows);
}
