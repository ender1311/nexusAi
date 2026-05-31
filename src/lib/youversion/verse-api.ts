// YouVersion internal Bible API — verse-text fetch + language→version_id map.
// Endpoint and headers mirror the reference implementation in
// appboy-api-automation/blog/apicall.py (get_verse) and the existing
// reading-plans usage in scripts/sync-plan-sets.ts.

export const VERSE_API_BASE = "https://bible.youversionapi.com/3.1/verses.json";

export const YV_HEADERS: Record<string, string> = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
  "User-Agent": "nexus-localized-verses",
};

// Language code (Nexus DB form — region variants use "_") → default Bible version_id.
// Ported from appboy-api-automation/blog/data_utils.py `language_meta`, converting
// the hyphenated keys (zh-CN, es-ES, pt-PT) to the underscore form the campaign
// content and push localizer use. "en" maps to 111 but is excluded from backfill
// by default since English verse text is already seeded.
export const LANGUAGE_VERSION_MAP: Record<string, number> = {
  af: 6,    am: 1260, ar: 13,   be: 1723, bg: 1443, bn: 1690, cs: 15,
  da: 20,   de: 73,   el: 921,  en: 111,  es: 149,  es_ES: 149, et: 309,
  fa: 118,  fi: 330,  fr: 133,  gu: 1911, he: 380,  hi: 1682, hu: 920,
  id: 306,  it: 122,  ja: 1820, ka: 2202, ki: 1622, km: 85,   kn: 1692,
  ko: 88,   lt: 419,  mk: 1501, ml: 1685, mn: 369,  mr: 1686, ms: 402,
  my: 386,  ne: 1483, nl: 75,   no: 102,  pa: 1687, pl: 2095, pt: 211,
  pt_PT: 228, ro: 191, ru: 400, si: 1828, sk: 464,  sr: 202,  sv: 154,
  sw: 164,  ta: 339,  te: 1787, th: 174,  tl: 399,  tr: 170,  uk: 186,
  ur: 189,  uz: 1730, vi: 151,  zh_CN: 48, zh_TW: 46, zu: 286,
};

/** Build the verses.json request URL. `references[]` is kept literal (only the
 *  USFM value is percent-encoded) to match the API's expected query shape. */
export function buildVerseUrl(usfm: string, versionId: number): string {
  return `${VERSE_API_BASE}?references[]=${encodeURIComponent(usfm)}&id=${versionId}&format=text`;
}

type VerseApiResponse = {
  response?: {
    data?: {
      reference?: { human?: unknown };
      verses?: Array<{ content?: unknown; reference?: { human?: unknown } }>;
    };
  };
};

/** Extract verse text from a verses.json response. Joins all returned verse
 *  contents (a USFM range yields one object per verse) with a single space.
 *  Returns null when the response has no usable content. */
export function parseVerseText(json: unknown): string | null {
  const verses = (json as VerseApiResponse)?.response?.data?.verses;
  if (!Array.isArray(verses) || verses.length === 0) return null;
  const text = verses
    .map((v) => (typeof v?.content === "string" ? v.content.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  return text || null;
}

export type VerseResult = { text: string | null; reference: string | null };

/** Localized human reference ("Juan 3:16"). Prefers the range-level
 *  data.reference.human; falls back to the first verse's reference.human. */
export function parseVerseRef(json: unknown): string | null {
  const data = (json as VerseApiResponse)?.response?.data;
  const top = data?.reference?.human;
  if (typeof top === "string" && top.trim()) return top.trim();
  const first = data?.verses?.[0]?.reference?.human;
  if (typeof first === "string" && first.trim()) return first.trim();
  return null;
}

/** Fetch verse text + localized reference in one request. */
export async function fetchVerse(
  usfm: string,
  versionId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<VerseResult> {
  let res: Response;
  try {
    res = await fetchImpl(buildVerseUrl(usfm, versionId), {
      headers: YV_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { text: null, reference: null };
  }
  if (!res.ok) return { text: null, reference: null };
  let json: unknown;
  try { json = await res.json(); } catch { return { text: null, reference: null }; }
  return { text: parseVerseText(json), reference: parseVerseRef(json) };
}

/** Fetch localized verse text for a USFM reference in a given Bible version.
 *  Returns null on a non-OK response, network/timeout error, or empty content.
 *  `fetchImpl` is injectable for testing. */
export async function fetchVerseText(
  usfm: string,
  versionId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(buildVerseUrl(usfm, versionId), {
      headers: YV_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  return parseVerseText(json);
}
